#!/usr/bin/env bash
set -euo pipefail

SESSION_FILTER="${1:-}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RECORDINGS_DIR="${ROOT_DIR}/infra/recordings"
STORAGE_DIR="${ROOT_DIR}/storage"

JANUS_RECORDING_DIRS=("/recordings" "/usr/local/share/janus/recordings")

mkdir -p "${STORAGE_DIR}"
mkdir -p "${RECORDINGS_DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required for conversion" >&2
  exit 1
fi

if ! docker compose ps janus >/dev/null 2>&1; then
  echo "janus service is not running. Start it with: docker compose up -d" >&2
  exit 1
fi

mapfile -t container_mjrs < <(
  docker compose exec -T janus sh -lc '
    for dir in /recordings /usr/local/share/janus/recordings; do
      if [ -d "$dir" ]; then
        ls "$dir"/*.mjr 2>/dev/null || true
      fi
    done
  '
)

if [[ "${#container_mjrs[@]}" -eq 0 ]]; then
  echo "No .mjr files found in Janus container. Will try host artifacts for merge." >&2
fi

converted_count=0
failed_count=0
merged_count=0
declare -A audio_by_session=()
declare -A video_by_session=()

merge_with_host_ffmpeg() {
  local video_file="$1"
  local audio_file="$2"
  local merged_file="$3"
  ffmpeg -y \
    -fflags +genpts \
    -i "${video_file}" \
    -i "${audio_file}" \
    -map 0:v:0 -map 1:a:0 \
    -c:v libx264 -preset veryfast -crf 24 -pix_fmt yuv420p \
    -c:a aac -b:a 128k \
    -af aresample=async=1:first_pts=0 \
    -movflags +faststart \
    -shortest "${merged_file}" >/dev/null 2>&1
}

merge_with_docker_ffmpeg() {
  local video_file="$1"
  local audio_file="$2"
  local merged_file="$3"
  local video_rel="${video_file#${ROOT_DIR}/}"
  local audio_rel="${audio_file#${ROOT_DIR}/}"
  local merged_rel="${merged_file#${ROOT_DIR}/}"

  docker run --rm \
    -v "${ROOT_DIR}:/work" \
    -w /work \
    jrottenberg/ffmpeg:6.0-alpine \
    -y \
    -fflags +genpts \
    -i "/work/${video_rel}" \
    -i "/work/${audio_rel}" \
    -map 0:v:0 -map 1:a:0 \
    -c:v libx264 -preset veryfast -crf 24 -pix_fmt yuv420p \
    -c:a aac -b:a 128k \
    -af aresample=async=1:first_pts=0 \
    -movflags +faststart \
    -shortest "/work/${merged_rel}" >/dev/null 2>&1
}

discover_existing_tracks() {
  local include_session_filter="${1:-}"

  shopt -s nullglob
  for video_file in "${STORAGE_DIR}"/*-video-*.webm; do
    local base
    local session_key
    base="$(basename "${video_file}" .webm)"
    session_key="${base%-video-*}"
    if [[ -n "${include_session_filter}" && "${session_key}" != *"${include_session_filter}"* ]]; then
      continue
    fi
    video_by_session["${session_key}"]="${video_file}"
  done

  for audio_file in "${RECORDINGS_DIR}"/*-audio-*.opus; do
    local base
    local session_key
    base="$(basename "${audio_file}" .opus)"
    session_key="${base%-audio-*}"
    if [[ -n "${include_session_filter}" && "${session_key}" != *"${include_session_filter}"* ]]; then
      continue
    fi
    audio_by_session["${session_key}"]="${audio_file}"
  done
}

for mjr_path in "${container_mjrs[@]}"; do
  base="$(basename "${mjr_path}" .mjr)"
  parent_dir="$(dirname "${mjr_path}")"

  if [[ "${base}" == rec-sample-* ]]; then
    continue
  fi

  if [[ -n "${SESSION_FILTER}" && "${base}" != *"${SESSION_FILTER}"* ]]; then
    continue
  fi

  target_ext="webm"
  if [[ "${base}" == *"-audio-"* ]]; then
    target_ext="opus"
  fi

  echo "Converting ${mjr_path} -> ${target_ext}"
  if ! docker compose exec -T janus janus-pp-rec "${mjr_path}" "${parent_dir}/${base}.${target_ext}"; then
    echo "Failed converting ${mjr_path}" >&2
    failed_count=$((failed_count + 1))
    continue
  fi

  # Always copy raw files to host for dashboard visibility.
  docker compose cp "janus:${mjr_path}" "${RECORDINGS_DIR}/${base}.mjr" >/dev/null

  # Copy converted files. Keep video artifacts in storage; keep audio artifacts in recordings.
  if [[ "${target_ext}" == "webm" || "${target_ext}" == "mp4" ]]; then
    docker compose cp "janus:${parent_dir}/${base}.${target_ext}" "${STORAGE_DIR}/${base}.${target_ext}" >/dev/null
    if [[ "${base}" == *"-video-"* ]]; then
      session_key="${base%-video-*}"
      video_by_session["${session_key}"]="${STORAGE_DIR}/${base}.${target_ext}"
    fi
  else
    docker compose cp "janus:${parent_dir}/${base}.${target_ext}" "${RECORDINGS_DIR}/${base}.${target_ext}" >/dev/null
    if [[ "${base}" == *"-audio-"* ]]; then
      session_key="${base%-audio-*}"
      audio_by_session["${session_key}"]="${RECORDINGS_DIR}/${base}.${target_ext}"
    fi
  fi
  converted_count=$((converted_count + 1))
done

discover_existing_tracks "${SESSION_FILTER}"

if [[ "${converted_count}" -eq 0 ]]; then
  if [[ "${#video_by_session[@]}" -eq 0 && "${#audio_by_session[@]}" -eq 0 ]]; then
    if [[ -n "${SESSION_FILTER}" ]]; then
      echo "No .mjr files matched session filter: ${SESSION_FILTER}" >&2
    else
      echo "No .mjr files matched conversion filters." >&2
    fi
    exit 1
  fi
  echo "No new container conversions; using existing host artifacts for merge." >&2
fi

ffmpeg_mode="none"
if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg_mode="host"
elif docker image inspect jrottenberg/ffmpeg:6.0-alpine >/dev/null 2>&1; then
  ffmpeg_mode="docker"
else
  echo "ffmpeg not found on host; pulling docker image jrottenberg/ffmpeg:6.0-alpine..." >&2
  if docker pull jrottenberg/ffmpeg:6.0-alpine >/dev/null 2>&1; then
    ffmpeg_mode="docker"
  fi
fi

for session_key in "${!video_by_session[@]}"; do
  video_file="${video_by_session[${session_key}]}"
  audio_file="${audio_by_session[${session_key}]:-}"
  merged_file="${STORAGE_DIR}/${session_key}-merged.mp4"

  if [[ -z "${audio_file}" || ! -f "${audio_file}" || ! -f "${video_file}" ]]; then
    continue
  fi

  if [[ -n "${SESSION_FILTER}" && "${session_key}" != *"${SESSION_FILTER}"* ]]; then
    continue
  fi

  if [[ "${ffmpeg_mode}" == "none" ]]; then
    echo "Skipping merge for ${session_key}: ffmpeg unavailable on host and docker image failed." >&2
    continue
  fi

  echo "Merging audio + video for session ${session_key} (${ffmpeg_mode} ffmpeg)"
  if [[ "${ffmpeg_mode}" == "host" ]]; then
    if merge_with_host_ffmpeg "${video_file}" "${audio_file}" "${merged_file}"; then
      merged_count=$((merged_count + 1))
    else
      echo "Failed to merge A/V for ${session_key}" >&2
    fi
  elif [[ "${ffmpeg_mode}" == "docker" ]]; then
    if merge_with_docker_ffmpeg "${video_file}" "${audio_file}" "${merged_file}"; then
      merged_count=$((merged_count + 1))
    else
      echo "Failed to merge A/V for ${session_key} using docker ffmpeg" >&2
    fi
  fi
done

if [[ "${merged_count}" -eq 0 && "${ffmpeg_mode}" == "none" ]]; then
  echo "ffmpeg unavailable: install ffmpeg or ensure docker can pull jrottenberg/ffmpeg:6.0-alpine" >&2
fi

if [[ "${failed_count}" -gt 0 ]]; then
  echo "Conversion complete with warnings. Success: ${converted_count}, Failed: ${failed_count}" >&2
else
  echo "Conversion complete. ${converted_count} file(s) converted."
fi
if [[ "${merged_count}" -gt 0 ]]; then
  echo "Merged ${merged_count} interview recording(s) with audio into ${STORAGE_DIR}"
fi
