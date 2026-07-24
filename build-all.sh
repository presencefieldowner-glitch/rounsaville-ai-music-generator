#!/bin/bash
################################################################################
# Rounsaville AI Music Generator — Master Build, Test & Full Tree Export Script
#
# Purpose:
#   1. Install, build, and test every module in the ecosystem in dependency order.
#   2. Recursively collect EVERY file from the entire repo tree.
#   3. Preserve the complete directory structure.
#   4. Optionally create a compressed .tar.gz archive of the full tree.
#
# Usage:
#   chmod +x build-all.sh
#
#   ./build-all.sh
#   ./build-all.sh --verbose
#   ./build-all.sh --no-test
#   ./build-all.sh --coverage
#   ./build-all.sh --clean
#   ./build-all.sh --download-all
#   ./build-all.sh --archive
#
# Flags:
#   --verbose       Show detailed output from each module
#   --no-test       Skip tests, build only
#   --coverage      Generate test coverage reports
#   --clean         Remove dist/ and node_modules/ before building
#   --download-all  Recursively copy EVERY file in the entire tree
#   --archive       Create a compressed archive of the entire tree
#
# Exit codes:
#   0 : Success
#   1 : One or more operations failed
#   2 : Invalid arguments
#
# Author:
#   Joseph Michael Rounsaville
#
# License:
#   Proprietary — see LICENSE.md / OWNERSHIP.md
################################################################################
set -uo pipefail

################################################################################
# Configuration
################################################################################
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERBOSE=false
RUN_TESTS=true
GENERATE_COVERAGE=false
CLEAN_FIRST=false
DOWNLOAD_ALL=false
CREATE_ARCHIVE=false
START_TIME=$(date +%s)

FAILED_MODULES=()
PASSED_MODULES=()
FAILED_OPERATIONS=()

################################################################################
# Color Codes
################################################################################
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

################################################################################
# Parse Arguments
################################################################################
while [[ $# -gt 0 ]]; do
  case "$1" in
    --verbose)
      VERBOSE=true
      shift
      ;;
    --no-test)
      RUN_TESTS=false
      shift
      ;;
    --coverage)
      GENERATE_COVERAGE=true
      shift
      ;;
    --clean)
      CLEAN_FIRST=true
      shift
      ;;
    --download-all)
      DOWNLOAD_ALL=true
      shift
      ;;
    --archive)
      CREATE_ARCHIVE=true
      shift
      ;;
    -h|--help)
      echo ""
      echo "Rounsaville AI Music Generator — Master Build & Export"
      echo ""
      echo "Usage:"
      echo "  ./build-all.sh [options]"
      echo ""
      echo "Options:"
      echo "  --verbose       Show detailed build output"
      echo "  --no-test       Skip tests"
      echo "  --coverage      Generate coverage reports"
      echo "  --clean         Clean dist/ and node_modules/"
      echo "  --download-all  Recursively copy every file in the tree"
      echo "  --archive       Create complete .tar.gz archive"
      echo "  --help          Show this help"
      echo ""
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      echo "Use --help for usage information."
      exit 2
      ;;
  esac
done

################################################################################
# Utility Functions
################################################################################
log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[✗]${NC} $1"; }

################################################################################
# Recursive Full Tree Export
################################################################################
download_all_files() {
  local source_root="$SCRIPT_DIR"
  local timestamp
  local export_dir

  timestamp="$(date '+%Y%m%d_%H%M%S')"
  export_dir="${SCRIPT_DIR}/_exports/RounsavilleAIMusicGenerator_${timestamp}"

  log_info "Starting complete recursive tree export..."
  mkdir -p "$export_dir"

  log_info "Source:      $source_root"
  log_info "Destination: $export_dir"
  echo ""

  if command -v rsync >/dev/null 2>&1; then
    log_info "Using rsync recursive export engine..."
    rsync -a \
      --exclude="_exports/" \
      --exclude=".git/" \
      "$source_root/" \
      "$export_dir/"
  else
    log_warning "rsync not found. Falling back to cp..."
    for item in "$source_root"/* "$source_root"/.[!.]* "$source_root"/..?*; do
      [[ -e "$item" ]] || continue
      case "$item" in
        "$source_root/_exports"|"$source_root/.git")
          continue
          ;;
      esac
      cp -a "$item" "$export_dir/"
    done
  fi

  local file_count directory_count
  file_count=$(find "$export_dir" -type f | wc -l | tr -d ' ')
  directory_count=$(find "$export_dir" -type d | wc -l | tr -d ' ')

  echo ""
  log_success "Complete tree export finished."
  echo "  Files exported:       $file_count"
  echo "  Directories exported: $directory_count"
  echo "  Export location:      $export_dir"

  log_info "Generating file manifest..."
  find "$export_dir" -type f -printf '%P\n' | sort > "$export_dir/FILE_MANIFEST.txt"
  log_success "Manifest created: $export_dir/FILE_MANIFEST.txt"
}

################################################################################
# Create Full Archive
################################################################################
create_full_archive() {
  local timestamp archive_path
  timestamp="$(date '+%Y%m%d_%H%M%S')"
  archive_path="${SCRIPT_DIR}/RounsavilleAIMusicGenerator_FULL_${timestamp}.tar.gz"

  log_info "Creating complete repository archive..."
  tar \
    --exclude="./.git" \
    --exclude="./node_modules" \
    --exclude="./_exports" \
    -czf "$archive_path" \
    -C "$SCRIPT_DIR" .

  if [[ -f "$archive_path" ]]; then
    local archive_size
    archive_size=$(du -h "$archive_path" | cut -f1)
    log_success "Full archive created."
    echo "  Archive: $archive_path"
    echo "  Size:    $archive_size"
  else
    log_error "Archive creation failed."
    FAILED_OPERATIONS+=("archive")
    return 1
  fi
}

################################################################################
# Build Single Module
################################################################################
run_module() {
  local module="$1"
  local module_path="${SCRIPT_DIR}/${module}"

  if [[ ! -d "$module_path" ]]; then
    log_error "Module not found: $module"
    FAILED_MODULES+=("$module")
    return 1
  fi

  if [[ ! -f "$module_path/package.json" ]]; then
    log_warning "No package.json found: $module"
    FAILED_MODULES+=("$module")
    return 1
  fi

  log_info "Processing module: $module"

  # Clean Phase
  if [[ "$CLEAN_FIRST" == true ]]; then
    log_info "  → Cleaning dist/ and node_modules/"
    rm -rf "$module_path/dist" "$module_path/node_modules"
  fi

  # Install Phase
  log_info "  → npm install"
  if [[ "$VERBOSE" == true ]]; then
    if ! (cd "$module_path" && npm install); then
      log_error "npm install failed: $module"
      FAILED_MODULES+=("$module")
      return 1
    fi
  else
    if ! (cd "$module_path" && npm install > /dev/null 2>&1); then
      log_error "npm install failed: $module"
      FAILED_MODULES+=("$module")
      return 1
    fi
  fi

  # Build Phase
  log_info "  → npm run build"
  if [[ "$VERBOSE" == true ]]; then
    if ! (cd "$module_path" && npm run build); then
      log_error "Build failed: $module"
      FAILED_MODULES+=("$module")
      return 1
    fi
  else
    if ! (cd "$module_path" && npm run build > /dev/null 2>&1); then
      log_error "Build failed: $module"
      FAILED_MODULES+=("$module")
      return 1
    fi
  fi

  # Test Phase
  if [[ "$RUN_TESTS" == true ]]; then
    if grep -q '"test"' "$module_path/package.json" 2>/dev/null; then
      log_info "  → npm test"
      if [[ "$VERBOSE" == true ]]; then
        if ! (cd "$module_path" && npm test); then
          log_error "Tests failed: $module"
          FAILED_MODULES+=("$module")
          return 1
        fi
      else
        if ! (cd "$module_path" && npm test > /dev/null 2>&1); then
          log_error "Tests failed: $module"
          FAILED_MODULES+=("$module")
          return 1
        fi
      fi
    else
      log_warning "  → No test script in package.json"
    fi
  fi

  PASSED_MODULES+=("$module")
  log_success "$module"
  return 0
}

################################################################################
# Main Process
################################################################################
main() {
  echo ""
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║   Rounsaville AI Music Generator — Master Build & Test          ║"
  echo "║   Author: Joseph Michael Rounsaville                            ║"
  echo "║   Start: $(date '+%Y-%m-%d %H:%M:%S')                          ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""

  log_info "Configuration:"
  echo "  Verbose output:   $VERBOSE"
  echo "  Run tests:        $RUN_TESTS"
  echo "  Coverage:         $GENERATE_COVERAGE"
  echo "  Clean first:      $CLEAN_FIRST"
  echo "  Download all:     $DOWNLOAD_ALL"
  echo "  Create archive:   $CREATE_ARCHIVE"
  echo ""

  # 1. Foundation & Shared Utilities
  log_info "Building Core Foundation..."
  Foundation=(
    "001_FOUNDATION/Types"
    "001_FOUNDATION/Utilities"
    "001_FOUNDATION/ProtocolSpecs"
  )
  for module in "${Foundation[@]}"; do run_module "$module" || true; done

  # 2. LLM & Prompt Pipeline (lyric/prompt-to-composition generation)
  log_info "Building LLM Orchestration Layer..."
  LLMLayer=(
    "002_LLM_GATEWAY/PromptEngine"
    "002_LLM_GATEWAY/ModelRouter"
    "002_LLM_GATEWAY/Guardrails"
    "002_LLM_GATEWAY/LyricsEngine"
  )
  for module in "${LLMLayer[@]}"; do run_module "$module" || true; done

  # 3. Audio Synthesis & Rendering Engine
  log_info "Building Audio Synthesis & Rendering Engine..."
  AudioLayer=(
    "003_AUDIO_ENGINE/SynthEngine"
    "003_AUDIO_ENGINE/AudioRenderer"
    "003_AUDIO_ENGINE/MixMaster"
    "003_AUDIO_ENGINE/VoiceProfiler"
    "003_AUDIO_ENGINE/PhaseVocoder"
  )
  for module in "${AudioLayer[@]}"; do run_module "$module" || true; done

  # 4. Composition Agent & State
  log_info "Building Composition Agent & Session Layer..."
  CompositionLayer=(
    "004_COMPOSITION_AGENT/SessionManager"
    "004_COMPOSITION_AGENT/CompositionMemory"
    "004_COMPOSITION_AGENT/TrackGenerator"
    "004_COMPOSITION_AGENT/GenerationPipeline"
  )
  for module in "${CompositionLayer[@]}"; do run_module "$module" || true; done

  # 5. Interface & Web Gateway
  log_info "Building Web & API Gateways..."
  InterfaceLayer=(
    "005_INTERFACE/WebSockets"
    "005_INTERFACE/JitterBuffer"
    "005_INTERFACE/REST_API"
    "005_INTERFACE/WebUI"
  )
  for module in "${InterfaceLayer[@]}"; do run_module "$module" || true; done

  # 6. Python Integration Tests (Audio DSP Verification)
  log_info "Testing Python Audio Runner..."
  if [[ -f "${SCRIPT_DIR}/003_AUDIO_ENGINE/PythonRunner/tests/test_runner.py" ]]; then
    (
      cd "${SCRIPT_DIR}/003_AUDIO_ENGINE/PythonRunner"
      python3 -m unittest discover tests/
    ) && log_success "Python Audio Runner tests passed" || {
      log_error "Python Audio Runner tests failed"
      FAILED_OPERATIONS+=("PythonAudioRunner")
    }
  else
    log_warning "Python Audio Runner tests not found"
  fi

  # 7. Full Recursive Export
  if [[ "$DOWNLOAD_ALL" == true ]]; then
    log_info "Executing full recursive tree export..."
    download_all_files
  fi

  # 8. Full Archive Creation
  if [[ "$CREATE_ARCHIVE" == true ]]; then
    log_info "Executing full archive creation..."
    create_full_archive
  fi

  # Summary
  local END_TIME DURATION
  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))

  echo ""
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║   Rounsaville AI Music Generator — Build Complete                ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""

  echo -e "${GREEN}Passed: ${#PASSED_MODULES[@]} modules${NC}"
  for module in "${PASSED_MODULES[@]}"; do echo "  ✓ $module"; done
  echo ""

  if [[ ${#FAILED_MODULES[@]} -gt 0 ]]; then
    echo -e "${RED}Failed Modules: ${#FAILED_MODULES[@]}${NC}"
    for module in "${FAILED_MODULES[@]}"; do echo "  ✗ $module"; done
    echo ""
  fi

  if [[ ${#FAILED_OPERATIONS[@]} -gt 0 ]]; then
    echo -e "${RED}Failed Operations: ${#FAILED_OPERATIONS[@]}${NC}"
    for operation in "${FAILED_OPERATIONS[@]}"; do echo "  ✗ $operation"; done
    echo ""
  fi

  echo "Duration: ${DURATION}s"
  echo ""

  if [[ ${#FAILED_MODULES[@]} -gt 0 || ${#FAILED_OPERATIONS[@]} -gt 0 ]]; then
    log_error "Build completed with failures."
    return 1
  fi

  log_success "Build, test, and export pipeline completed successfully!"
  return 0
}

################################################################################
# Execute
################################################################################
main "$@"
