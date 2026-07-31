#!/usr/bin/env bash

################################################################################
# Rounsaville AI Music Generator
# Master Build, Test, Audit, Coverage, Export & Archive Orchestrator
#
# Author:
#   Joseph Michael Rounsaville
#
# Purpose:
#   Enterprise-style orchestration pipeline for the complete Rounsaville
#   AI Music Generator ecosystem.
#
# Core Responsibilities:
#   1. Validate the execution environment.
#   2. Validate repository structure.
#   3. Discover available toolchains.
#   4. Build modules in dependency order.
#   5. Install dependencies safely.
#   6. Run builds, tests, linting, and type checking.
#   7. Optionally generate coverage reports.
#   8. Optionally perform security audits.
#   9. Capture detailed per-module logs.
#  10. Generate JSON and Markdown build reports.
#  11. Generate SHA-256 file integrity manifests.
#  12. Export the complete repository tree.
#  13. Create compressed repository archives.
#  14. Inventory build artifacts.
#  15. Produce a final system readiness report.
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
#   ./build-all.sh --audit
#   ./build-all.sh --lint
#   ./build-all.sh --typecheck
#   ./build-all.sh --parallel 4
#   ./build-all.sh --retry 2
#   ./build-all.sh --dry-run
#   ./build-all.sh --ci
#   ./build-all.sh --full
#
# Exit Codes:
#   0 : Complete success
#   1 : One or more operations failed
#   2 : Invalid arguments
#   3 : Environment validation failed
#   4 : Repository validation failed
#
# License:
#   Proprietary — see LICENSE.md / OWNERSHIP.md
################################################################################

set -uo pipefail

################################################################################
# Script Metadata
################################################################################

SCRIPT_NAME="$(basename "$0")"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
START_TIME="$(date +%s)"
START_TIMESTAMP="$(date '+%Y-%m-%dT%H:%M:%S%z')"

################################################################################
# Default Configuration
################################################################################

VERBOSE=false
RUN_TESTS=true
GENERATE_COVERAGE=false
CLEAN_FIRST=false
DOWNLOAD_ALL=false
CREATE_ARCHIVE=false
RUN_AUDIT=false
RUN_LINT=false
RUN_TYPECHECK=false
DRY_RUN=false
CI_MODE=false

PARALLEL_JOBS=1
MAX_RETRIES=0
COMMAND_TIMEOUT=0

REPORT_DIR="${SCRIPT_DIR}/_build_reports"
LOG_DIR="${REPORT_DIR}/logs"
EXPORT_DIR="${SCRIPT_DIR}/_exports"
ARCHIVE_DIR="${SCRIPT_DIR}/_archives"

BUILD_ID="$(date '+%Y%m%d_%H%M%S')"

################################################################################
# Result Tracking
################################################################################

PASSED_MODULES=()
FAILED_MODULES=()
SKIPPED_MODULES=()

PASSED_OPERATIONS=()
FAILED_OPERATIONS=()
SKIPPED_OPERATIONS=()

MODULE_BUILD_TIMES=()

TOTAL_MODULES=0
COMPLETED_MODULES=0

################################################################################
# Tool Detection
################################################################################

NODE_VERSION="unknown"
NPM_VERSION="unknown"
PYTHON_VERSION="unknown"
GIT_VERSION="unknown"

HAS_NODE=false
HAS_NPM=false
HAS_PYTHON=false
HAS_GIT=false
HAS_RSYNC=false
HAS_TAR=false
HAS_SHA256SUM=false
HAS_TIMEOUT=false
HAS_JQ=false

################################################################################
# Colors
################################################################################

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
WHITE='\033[1;37m'
NC='\033[0m'

################################################################################
# Logging
################################################################################

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[✗]${NC} $1"
}

log_debug() {
  if [[ "$VERBOSE" == true ]]; then
    echo -e "${CYAN}[DEBUG]${NC} $1"
  fi
}

log_section() {
  echo ""
  echo -e "${MAGENTA}================================================================${NC}"
  echo -e "${WHITE}$1${NC}"
  echo -e "${MAGENTA}================================================================${NC}"
  echo ""
}

################################################################################
# Help
################################################################################

show_help() {
  cat <<'EOF'

Rounsaville AI Music Generator
Master Build, Test, Audit, Coverage & Export Orchestrator

Usage:

  ./build-all.sh [options]

Build Options:

  --verbose
      Show detailed command output.

  --no-test
      Skip JavaScript/Node test execution.

  --coverage
      Run tests with coverage where supported.

  --clean
      Remove dist/, build/, coverage/, and node_modules/
      before building.

  --audit
      Run npm security audits where supported.

  --lint
      Run npm lint scripts where available.

  --typecheck
      Run npm typecheck scripts where available.

Execution:

  --parallel N
      Run independent module operations using N workers.
      Default: 1.

  --retry N
      Retry failed operations N times.

  --timeout N
      Timeout individual commands after N seconds.
      0 means no timeout.

  --dry-run
      Display planned operations without executing them.

  --ci
      CI-friendly mode with reduced interactive output.

Export:

  --download-all
      Recursively export the repository tree.

  --archive
      Create a compressed .tar.gz repository archive.

Reporting:

  --report-dir PATH
      Store build reports in PATH.

  --log-dir PATH
      Store module logs in PATH.

Convenience:

  --full
      Equivalent to:

        --clean
        --coverage
        --audit
        --lint
        --typecheck
        --download-all
        --archive

  --help
      Show this help.

Examples:

  ./build-all.sh

  ./build-all.sh --verbose

  ./build-all.sh --clean --coverage

  ./build-all.sh --audit --lint --typecheck

  ./build-all.sh --parallel 4

  ./build-all.sh --full

EOF
}

################################################################################
# Argument Parsing
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

    --audit)
      RUN_AUDIT=true
      shift
      ;;

    --lint)
      RUN_LINT=true
      shift
      ;;

    --typecheck)
      RUN_TYPECHECK=true
      shift
      ;;

    --dry-run)
      DRY_RUN=true
      shift
      ;;

    --ci)
      CI_MODE=true
      VERBOSE=false
      shift
      ;;

    --parallel)
      if [[ -z "${2:-}" || ! "$2" =~ ^[0-9]+$ || "$2" -lt 1 ]]; then
        log_error "--parallel requires a positive integer."
        exit 2
      fi

      PARALLEL_JOBS="$2"
      shift 2
      ;;

    --retry)
      if [[ -z "${2:-}" || ! "$2" =~ ^[0-9]+$ ]]; then
        log_error "--retry requires a non-negative integer."
        exit 2
      fi

      MAX_RETRIES="$2"
      shift 2
      ;;

    --timeout)
      if [[ -z "${2:-}" || ! "$2" =~ ^[0-9]+$ ]]; then
        log_error "--timeout requires a non-negative integer."
        exit 2
      fi

      COMMAND_TIMEOUT="$2"
      shift 2
      ;;

    --report-dir)
      if [[ -z "${2:-}" ]]; then
        log_error "--report-dir requires a path."
        exit 2
      fi

      REPORT_DIR="$2"
      shift 2
      ;;

    --log-dir)
      if [[ -z "${2:-}" ]]; then
        log_error "--log-dir requires a path."
        exit 2
      fi

      LOG_DIR="$2"
      shift 2
      ;;

    --full)
      CLEAN_FIRST=true
      GENERATE_COVERAGE=true
      RUN_AUDIT=true
      RUN_LINT=true
      RUN_TYPECHECK=true
      DOWNLOAD_ALL=true
      CREATE_ARCHIVE=true
      shift
      ;;

    -h|--help)
      show_help
      exit 0
      ;;

    *)
      log_error "Unknown argument: $1"
      echo "Use --help for usage information."
      exit 2
      ;;

  esac

done

################################################################################
# Directory Initialization
################################################################################

initialize_directories() {

  if [[ "$DRY_RUN" == true ]]; then
    return 0
  fi

  mkdir -p \
    "$REPORT_DIR" \
    "$LOG_DIR" \
    "$EXPORT_DIR" \
    "$ARCHIVE_DIR"

  log_debug "Report directory: $REPORT_DIR"
  log_debug "Log directory:    $LOG_DIR"
  log_debug "Export directory: $EXPORT_DIR"
  log_debug "Archive directory: $ARCHIVE_DIR"
}

################################################################################
# Toolchain Detection
################################################################################

detect_toolchain() {

  log_section "PHASE 1 — TOOLCHAIN DETECTION"

  if command -v node >/dev/null 2>&1; then
    HAS_NODE=true
    NODE_VERSION="$(node --version 2>/dev/null || echo unknown)"
    log_success "Node.js detected: $NODE_VERSION"
  else
    log_error "Node.js not detected."
  fi

  if command -v npm >/dev/null 2>&1; then
    HAS_NPM=true
    NPM_VERSION="$(npm --version 2>/dev/null || echo unknown)"
    log_success "npm detected: $NPM_VERSION"
  else
    log_error "npm not detected."
  fi

  if command -v python3 >/dev/null 2>&1; then
    HAS_PYTHON=true
    PYTHON_VERSION="$(python3 --version 2>/dev/null || echo unknown)"
    log_success "Python detected: $PYTHON_VERSION"
  else
    log_warning "Python3 not detected."
  fi

  if command -v git >/dev/null 2>&1; then
    HAS_GIT=true
    GIT_VERSION="$(git --version 2>/dev/null || echo unknown)"
    log_success "Git detected: $GIT_VERSION"
  else
    log_warning "Git not detected."
  fi

  if command -v rsync >/dev/null 2>&1; then
    HAS_RSYNC=true
    log_success "rsync detected."
  else
    log_warning "rsync not detected. cp fallback will be used."
  fi

  if command -v tar >/dev/null 2>&1; then
    HAS_TAR=true
    log_success "tar detected."
  else
    log_error "tar not detected."
  fi

  if command -v sha256sum >/dev/null 2>&1; then
    HAS_SHA256SUM=true
    log_success "sha256sum detected."
  else
    log_warning "sha256sum not detected."
  fi

  if command -v timeout >/dev/null 2>&1; then
    HAS_TIMEOUT=true
    log_success "timeout command detected."
  else
    log_warning "timeout command not detected."
  fi

  if command -v jq >/dev/null 2>&1; then
    HAS_JQ=true
    log_success "jq detected."
  else
    log_debug "jq not detected."
  fi

  if [[ "$HAS_NODE" == false || "$HAS_NPM" == false ]]; then
    log_error "Required Node.js/npm toolchain is unavailable."
    return 1
  fi

  return 0
}

################################################################################
# Environment Snapshot
################################################################################

capture_environment() {

  local output_file="${REPORT_DIR}/environment_${BUILD_ID}.txt"

  if [[ "$DRY_RUN" == true ]]; then
    return 0
  fi

  log_info "Capturing environment snapshot..."

  {
    echo "Rounsaville AI Music Generator"
    echo "Environment Snapshot"
    echo "===================="
    echo ""
    echo "Timestamp: $START_TIMESTAMP"
    echo "Host: $(hostname 2>/dev/null || echo unknown)"
    echo "OS: $(uname -a 2>/dev/null || echo unknown)"
    echo "Working Directory: $SCRIPT_DIR"
    echo ""
    echo "Node.js: $NODE_VERSION"
    echo "npm: $NPM_VERSION"
    echo "Python: $PYTHON_VERSION"
    echo "Git: $GIT_VERSION"
    echo ""
    echo "Parallel Jobs: $PARALLEL_JOBS"
    echo "Max Retries: $MAX_RETRIES"
    echo "Timeout: $COMMAND_TIMEOUT"
    echo ""
    echo "Disk Usage:"
    df -h "$SCRIPT_DIR" 2>/dev/null || true
    echo ""
    echo "Memory:"
    free -h 2>/dev/null || true
  } > "$output_file"

  log_success "Environment snapshot created."
}

################################################################################
# Git Metadata
################################################################################

capture_git_metadata() {

  local output_file="${REPORT_DIR}/git_${BUILD_ID}.txt"

  if [[ "$HAS_GIT" == false || "$DRY_RUN" == true ]]; then
    return 0
  fi

  log_info "Capturing Git repository metadata..."

  {
    echo "Git Repository Metadata"
    echo "======================="
    echo ""
    echo "Repository Root:"
    git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true
    echo ""
    echo "Branch:"
    git -C "$SCRIPT_DIR" branch --show-current 2>/dev/null || true
    echo ""
    echo "Commit:"
    git -C "$SCRIPT_DIR" rev-parse HEAD 2>/dev/null || true
    echo ""
    echo "Status:"
    git -C "$SCRIPT_DIR" status --short 2>/dev/null || true
  } > "$output_file"

  log_success "Git metadata captured."
}

################################################################################
# Repository Validation
################################################################################

validate_repository() {

  log_section "PHASE 2 — REPOSITORY VALIDATION"

  local required_dirs=(
    "001_FOUNDATION"
    "002_LLM_GATEWAY"
    "003_AUDIO_ENGINE"
    "004_COMPOSITION_AGENT"
    "005_INTERFACE"
  )

  local missing=0

  for dir in "${required_dirs[@]}"; do

    if [[ -d "${SCRIPT_DIR}/${dir}" ]]; then
      log_success "Found: $dir"
    else
      log_warning "Missing: $dir"
      missing=$((missing + 1))
    fi

  done

  if [[ "$missing" -gt 0 ]]; then
    log_warning "$missing expected top-level directories are missing."
  fi

  return 0
}

################################################################################
# Command Runner
################################################################################

run_command() {

  local working_dir="$1"
  shift

  local command_string="$*"

  log_debug "Executing: cd $working_dir && $command_string"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] cd $working_dir && $command_string"
    return 0
  fi

  if [[ "$COMMAND_TIMEOUT" -gt 0 && "$HAS_TIMEOUT" == true ]]; then

    timeout "$COMMAND_TIMEOUT" \
      bash -c "cd \"$working_dir\" && $command_string"

  else

    (
      cd "$working_dir" &&
      bash -c "$command_string"
    )

  fi
}

################################################################################
# Operation Runner With Retry
################################################################################

run_operation() {

  local module="$1"
  local operation="$2"
  local command="$3"

  local attempt=0
  local max_attempts=$((MAX_RETRIES + 1))

  local safe_module
  safe_module="$(echo "$module" | tr '/ ' '__')"

  local log_file="${LOG_DIR}/${safe_module}_${operation}_${BUILD_ID}.log"

  while [[ "$attempt" -lt "$max_attempts" ]]; do

    attempt=$((attempt + 1))

    log_info "[$module] $operation — attempt $attempt/$max_attempts"

    if [[ "$DRY_RUN" == true ]]; then
      echo "[DRY-RUN] $command"
      PASSED_OPERATIONS+=("${module}:${operation}")
      return 0
    fi

    if [[ "$VERBOSE" == true ]]; then

      if run_command "$SCRIPT_DIR/$module" "$command" 2>&1 | tee "$log_file"; then
        PASSED_OPERATIONS+=("${module}:${operation}")
        return 0
      fi

    else

      if run_command "$SCRIPT_DIR/$module" "$command" > "$log_file" 2>&1; then
        PASSED_OPERATIONS+=("${module}:${operation}")
        return 0
      fi

    fi

    log_warning "Operation failed: $module / $operation"

    if [[ "$attempt" -lt "$max_attempts" ]]; then
      log_warning "Retrying..."
      sleep 1
    fi

  done

  FAILED_OPERATIONS+=("${module}:${operation}")

  log_error "Operation permanently failed: $module / $operation"

  if [[ "$VERBOSE" == false && -f "$log_file" ]]; then
    log_error "See log: $log_file"
  fi

  return 1
}

################################################################################
# Clean Module
################################################################################

clean_module() {

  local module="$1"
  local module_path="${SCRIPT_DIR}/${module}"

  log_info "Cleaning module: $module"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] rm -rf dist build coverage node_modules"
    return 0
  fi

  rm -rf \
    "$module_path/dist" \
    "$module_path/build" \
    "$module_path/coverage" \
    "$module_path/node_modules"

  log_success "Clean complete: $module"
}

################################################################################
# Dependency Installation
################################################################################

install_dependencies() {

  local module="$1"
  local module_path="${SCRIPT_DIR}/${module}"

  if [[ -f "$module_path/package-lock.json" ]]; then

    run_operation \
      "$module" \
      "npm-ci" \
      "npm ci"

  else

    run_operation \
      "$module" \
      "npm-install" \
      "npm install"

  fi
}

################################################################################
# Build Operation
################################################################################

build_module() {

  local module="$1"

  if ! grep -q '"build"' \
    "${SCRIPT_DIR}/${module}/package.json" \
    2>/dev/null; then

    log_warning "No build script found: $module"
    SKIPPED_OPERATIONS+=("${module}:build")
    return 0
  fi

  run_operation \
    "$module" \
    "build" \
    "npm run build"
}

################################################################################
# Test Operation
################################################################################

test_module() {

  local module="$1"

  if [[ "$RUN_TESTS" == false ]]; then
    SKIPPED_OPERATIONS+=("${module}:test")
    return 0
  fi

  if ! grep -q '"test"' \
    "${SCRIPT_DIR}/${module}/package.json" \
    2>/dev/null; then

    log_warning "No test script found: $module"
    SKIPPED_OPERATIONS+=("${module}:test")
    return 0
  fi

  if [[ "$GENERATE_COVERAGE" == true ]]; then

    if grep -q '"coverage"' \
      "${SCRIPT_DIR}/${module}/package.json" \
      2>/dev/null; then

      run_operation \
        "$module" \
        "coverage" \
        "npm run coverage"

      return $?

    fi

  fi

  run_operation \
    "$module" \
    "test" \
    "npm test"
}

################################################################################
# Lint Operation
################################################################################

lint_module() {

  local module="$1"

  if [[ "$RUN_LINT" == false ]]; then
    return 0
  fi

  if grep -q '"lint"' \
    "${SCRIPT_DIR}/${module}/package.json" \
    2>/dev/null; then

    run_operation \
      "$module" \
      "lint" \
      "npm run lint"

  else

    log_debug "No lint script: $module"

  fi
}

################################################################################
# Type Check Operation
################################################################################

typecheck_module() {

  local module="$1"

  if [[ "$RUN_TYPECHECK" == false ]]; then
    return 0
  fi

  if grep -q '"typecheck"' \
    "${SCRIPT_DIR}/${module}/package.json" \
    2>/dev/null; then

    run_operation \
      "$module" \
      "typecheck" \
      "npm run typecheck"

  elif grep -q '"type-check"' \
    "${SCRIPT_DIR}/${module}/package.json" \
    2>/dev/null; then

    run_operation \
      "$module" \
      "type-check" \
      "npm run type-check"

  else

    log_debug "No typecheck script: $module"

  fi
}

################################################################################
# Security Audit
################################################################################

audit_module() {

  local module="$1"

  if [[ "$RUN_AUDIT" == false ]]; then
    return 0
  fi

  run_operation \
    "$module" \
    "audit" \
    "npm audit --audit-level=high"
}

################################################################################
# Build Single Module
################################################################################

run_module() {

  local module="$1"
  local module_path="${SCRIPT_DIR}/${module}"

  local module_start
  module_start="$(date +%s)"

  TOTAL_MODULES=$((TOTAL_MODULES + 1))

  if [[ ! -d "$module_path" ]]; then
    log_error "Module directory not found: $module"
    FAILED_MODULES+=("$module")
    return 1
  fi

  if [[ ! -f "$module_path/package.json" ]]; then
    log_warning "No package.json found: $module"
    SKIPPED_MODULES+=("$module")
    return 0
  fi

  log_section "MODULE — $module"

  if [[ "$CLEAN_FIRST" == true ]]; then
    clean_module "$module"
  fi

  if ! install_dependencies "$module"; then
    FAILED_MODULES+=("$module")
    return 1
  fi

  if ! build_module "$module"; then
    FAILED_MODULES+=("$module")
    return 1
  fi

  if ! lint_module "$module"; then
    FAILED_MODULES+=("$module")
    return 1
  fi

  if ! typecheck_module "$module"; then
    FAILED_MODULES+=("$module")
    return 1
  fi

  if ! test_module "$module"; then
    FAILED_MODULES+=("$module")
    return 1
  fi

  if ! audit_module "$module"; then
    FAILED_MODULES+=("$module")
    return 1
  fi

  local module_end
  module_end="$(date +%s)"

  local duration
  duration=$((module_end - module_start))

  MODULE_BUILD_TIMES+=("${module}=${duration}s")

  PASSED_MODULES+=("$module")

  COMPLETED_MODULES=$((COMPLETED_MODULES + 1))

  log_success "$module completed in ${duration}s"

  return 0
}

################################################################################
# Python Test Runner
################################################################################

run_python_tests() {

  if [[ "$HAS_PYTHON" == false ]]; then
    log_warning "Python3 unavailable. Python tests skipped."
    SKIPPED_OPERATIONS+=("PythonAudioRunner:test")
    return 0
  fi

  local python_root="${SCRIPT_DIR}/003_AUDIO_ENGINE/PythonRunner"
  local test_dir="${python_root}/tests"

  if [[ ! -d "$test_dir" ]]; then
    log_warning "Python test directory not found."
    SKIPPED_OPERATIONS+=("PythonAudioRunner:test")
    return 0
  fi

  log_section "PYTHON AUDIO DSP TEST SUITE"

  local log_file="${LOG_DIR}/PythonAudioRunner_${BUILD_ID}.log"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] python3 -m unittest discover tests"
    PASSED_OPERATIONS+=("PythonAudioRunner:test")
    return 0
  fi

  if (
    cd "$python_root" &&
    python3 -m unittest discover tests
  ) > "$log_file" 2>&1; then

    PASSED_OPERATIONS+=("PythonAudioRunner:test")
    log_success "Python Audio Runner tests passed."

  else

    FAILED_OPERATIONS+=("PythonAudioRunner:test")
    log_error "Python Audio Runner tests failed."
    log_error "See log: $log_file"
    return 1

  fi
}

################################################################################
# Full Recursive Tree Export
################################################################################

download_all_files() {

  local timestamp
  timestamp="$(date '+%Y%m%d_%H%M%S')"

  local export_dir
  export_dir="${EXPORT_DIR}/RounsavilleAIMusicGenerator_${timestamp}"

  log_section "FULL REPOSITORY TREE EXPORT"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Export destination: $export_dir"
    return 0
  fi

  mkdir -p "$export_dir"

  if [[ "$HAS_RSYNC" == true ]]; then

    rsync -a \
      --exclude="_exports/" \
      --exclude="_archives/" \
      --exclude="_build_reports/" \
      --exclude=".git/" \
      --exclude="node_modules/" \
      "$SCRIPT_DIR/" \
      "$export_dir/"

  else

    log_warning "Using cp fallback."

    for item in \
      "$SCRIPT_DIR"/* \
      "$SCRIPT_DIR"/.[!.]* \
      "$SCRIPT_DIR"/..?*; do

      [[ -e "$item" ]] || continue

      case "$item" in

        "$SCRIPT_DIR/_exports")
          continue
          ;;

        "$SCRIPT_DIR/_archives")
          continue
          ;;

        "$SCRIPT_DIR/_build_reports")
          continue
          ;;

        "$SCRIPT_DIR/.git")
          continue
          ;;

        *)
          cp -a "$item" "$export_dir/"
          ;;

      esac

    done

  fi

  local file_count
  local directory_count

  file_count="$(
    find "$export_dir" \
      -type f \
      ! -name "FILE_MANIFEST.txt" \
      | wc -l \
      | tr -d ' '
  )"

  directory_count="$(
    find "$export_dir" \
      -type d \
      | wc -l \
      | tr -d ' '
  )"

  find "$export_dir" \
    -type f \
    ! -name "FILE_MANIFEST.txt" \
    -printf '%P\n' \
    | sort \
    > "$export_dir/FILE_MANIFEST.txt"

  if [[ "$HAS_SHA256SUM" == true ]]; then

    (
      cd "$export_dir" &&
      find . \
        -type f \
        ! -name "SHA256SUMS.txt" \
        -print0 \
        | sort -z \
        | xargs -0 sha256sum
    ) > "$export_dir/SHA256SUMS.txt"

  fi

  log_success "Complete tree export finished."

  echo "  Files:       $file_count"
  echo "  Directories: $directory_count"
  echo "  Location:    $export_dir"

  PASSED_OPERATIONS+=("repository:export")
}

################################################################################
# Archive Creation
################################################################################

create_full_archive() {

  if [[ "$HAS_TAR" == false ]]; then
    log_error "tar unavailable. Cannot create archive."
    FAILED_OPERATIONS+=("archive")
    return 1
  fi

  local timestamp
  timestamp="$(date '+%Y%m%d_%H%M%S')"

  local archive_path
  archive_path="${ARCHIVE_DIR}/RounsavilleAIMusicGenerator_FULL_${timestamp}.tar.gz"

  log_section "FULL REPOSITORY ARCHIVE"

  if [[ "$DRY_RUN" == true ]]; then
    echo "[DRY-RUN] Archive: $archive_path"
    return 0
  fi

  if tar \
    --exclude="./.git" \
    --exclude="./node_modules" \
    --exclude="./_exports" \
    --exclude="./_archives" \
    --exclude="./_build_reports" \
    -czf "$archive_path" \
    -C "$SCRIPT_DIR" .; then

    local archive_size
    archive_size="$(du -h "$archive_path" | cut -f1)"

    log_success "Archive created."
    echo "  Archive: $archive_path"
    echo "  Size:    $archive_size"

    PASSED_OPERATIONS+=("repository:archive")

  else

    log_error "Archive creation failed."
    FAILED_OPERATIONS+=("repository:archive")
    return 1

  fi
}

################################################################################
# Artifact Inventory
################################################################################

generate_artifact_inventory() {

  local inventory_file
  inventory_file="${REPORT_DIR}/artifacts_${BUILD_ID}.txt"

  if [[ "$DRY_RUN" == true ]]; then
    return 0
  fi

  log_info "Generating build artifact inventory..."

  {
    echo "Rounsaville AI Music Generator"
    echo "Build Artifact Inventory"
    echo "========================"
    echo ""
    echo "Generated: $(date '+%Y-%m-%d %H:%M:%S')"
    echo ""

    find "$SCRIPT_DIR" \
      \( -path "*/dist/*" \
      -o -path "*/build/*" \
      -o -path "*/coverage/*" \) \
      -type f \
      -print \
      2>/dev/null \
      | sort

  } > "$inventory_file"

  log_success "Artifact inventory created."
}

################################################################################
# JSON Report
################################################################################

generate_json_report() {

  local report_file
  report_file="${REPORT_DIR}/build_${BUILD_ID}.json"

  if [[ "$DRY_RUN" == true ]]; then
    return 0
  fi

  local end_time
  end_time="$(date +%s)"

  local duration
  duration=$((end_time - START_TIME))

  {
    echo "{"
    echo "  \"project\": \"Rounsaville AI Music Generator\","
    echo "  \"author\": \"Joseph Michael Rounsaville\","
    echo "  \"build_id\": \"$BUILD_ID\","
    echo "  \"start_timestamp\": \"$START_TIMESTAMP\","
    echo "  \"duration_seconds\": $duration,"
    echo "  \"configuration\": {"
    echo "    \"verbose\": $VERBOSE,"
    echo "    \"run_tests\": $RUN_TESTS,"
    echo "    \"coverage\": $GENERATE_COVERAGE,"
    echo "    \"clean\": $CLEAN_FIRST,"
    echo "    \"audit\": $RUN_AUDIT,"
    echo "    \"lint\": $RUN_LINT,"
    echo "    \"typecheck\": $RUN_TYPECHECK,"
    echo "    \"parallel_jobs\": $PARALLEL_JOBS,"
    echo "    \"max_retries\": $MAX_RETRIES"
    echo "  },"
    echo "  \"summary\": {"
    echo "    \"total_modules\": ${TOTAL_MODULES},"
    echo "    \"completed_modules\": ${COMPLETED_MODULES},"
    echo "    \"passed_modules\": ${#PASSED_MODULES[@]},"
    echo "    \"failed_modules\": ${#FAILED_MODULES[@]},"
    echo "    \"skipped_modules\": ${#SKIPPED_MODULES[@]},"
    echo "    \"failed_operations\": ${#FAILED_OPERATIONS[@]}"
    echo "  },"
    echo "  \"status\": \"$(
      if [[ ${#FAILED_MODULES[@]} -gt 0 || ${#FAILED_OPERATIONS[@]} -gt 0 ]]; then
        echo "FAILED"
      else
        echo "SUCCESS"
      fi
    )\""
    echo "}"

  } > "$report_file"

  log_success "JSON build report created: $report_file"
}

################################################################################
# Markdown Report
################################################################################

generate_markdown_report() {

  local report_file
  report_file="${REPORT_DIR}/BUILD_REPORT_${BUILD_ID}.md"

  if [[ "$DRY_RUN" == true ]]; then
    return 0
  fi

  local end_time
  end_time="$(date +%s)"

  local duration
  duration=$((end_time - START_TIME))

  {
    echo "# Rounsaville AI Music Generator"
    echo ""
    echo "## Master Build Report"
    echo ""
    echo "**Author:** Joseph Michael Rounsaville"
    echo ""
    echo "**Build ID:** \`$BUILD_ID\`"
    echo ""
    echo "**Status:** $(
      if [[ ${#FAILED_MODULES[@]} -gt 0 || ${#FAILED_OPERATIONS[@]} -gt 0 ]]; then
        echo "FAILED"
      else
        echo "SUCCESS"
      fi
    )"
    echo ""
    echo "**Duration:** ${duration}s"
    echo ""

    echo "## Summary"
    echo ""
    echo "| Metric | Value |"
    echo "|---|---:|"
    echo "| Total Modules | $TOTAL_MODULES |"
    echo "| Completed Modules | $COMPLETED_MODULES |"
    echo "| Passed Modules | ${#PASSED_MODULES[@]} |"
    echo "| Failed Modules | ${#FAILED_MODULES[@]} |"
    echo "| Skipped Modules | ${#SKIPPED_MODULES[@]} |"
    echo "| Failed Operations | ${#FAILED_OPERATIONS[@]} |"
    echo ""

    echo "## Passed Modules"
    echo ""

    for module in "${PASSED_MODULES[@]}"; do
      echo "- ✅ $module"
    done

    echo ""

    echo "## Failed Modules"
    echo ""

    if [[ ${#FAILED_MODULES[@]} -eq 0 ]]; then
      echo "None."
    else
      for module in "${FAILED_MODULES[@]}"; do
        echo "- ❌ $module"
      done
    fi

    echo ""

    echo "## Failed Operations"
    echo ""

    if [[ ${#FAILED_OPERATIONS[@]} -eq 0 ]]; then
      echo "None."
    else
      for operation in "${FAILED_OPERATIONS[@]}"; do
        echo "- ❌ $operation"
      done
    fi

    echo ""

    echo "## Module Timing"
    echo ""

    for timing in "${MODULE_BUILD_TIMES[@]}"; do
      echo "- $timing"
    done

    echo ""

    echo "## Environment"
    echo ""
    echo "- Node.js: $NODE_VERSION"
    echo "- npm: $NPM_VERSION"
    echo "- Python: $PYTHON_VERSION"
    echo "- Git: $GIT_VERSION"

  } > "$report_file"

  log_success "Markdown build report created: $report_file"
}

################################################################################
# Final Summary
################################################################################

print_final_summary() {

  local end_time
  end_time="$(date +%s)"

  local duration
  duration=$((end_time - START_TIME))

  log_section "FINAL SYSTEM READINESS REPORT"

  echo "Project:"
  echo "  Rounsaville AI Music Generator"
  echo ""

  echo "Build ID:"
  echo "  $BUILD_ID"
  echo ""

  echo "Duration:"
  echo "  ${duration}s"
  echo ""

  echo "Modules:"
  echo "  Total:     $TOTAL_MODULES"
  echo "  Passed:    ${#PASSED_MODULES[@]}"
  echo "  Failed:    ${#FAILED_MODULES[@]}"
  echo "  Skipped:   ${#SKIPPED_MODULES[@]}"
  echo ""

  echo "Operations:"
  echo "  Passed:    ${#PASSED_OPERATIONS[@]}"
  echo "  Failed:    ${#FAILED_OPERATIONS[@]}"
  echo "  Skipped:   ${#SKIPPED_OPERATIONS[@]}"
  echo ""

  if [[ ${#FAILED_MODULES[@]} -gt 0 ]]; then

    echo -e "${RED}Failed Modules:${NC}"

    for module in "${FAILED_MODULES[@]}"; do
      echo "  ✗ $module"
    done

    echo ""

  fi

  if [[ ${#FAILED_OPERATIONS[@]} -gt 0 ]]; then

    echo -e "${RED}Failed Operations:${NC}"

    for operation in "${FAILED_OPERATIONS[@]}"; do
      echo "  ✗ $operation"
    done

    echo ""

  fi

  echo "Reports:"
  echo "  $REPORT_DIR"
  echo ""

  if [[ ${#FAILED_MODULES[@]} -gt 0 || ${#FAILED_OPERATIONS[@]} -gt 0 ]]; then

    log_error "SYSTEM READINESS: FAILED"
    echo ""
    echo "The repository build pipeline completed with one or more failures."
    echo "Review the generated logs and reports before deployment."

    return 1

  fi

  log_success "SYSTEM READINESS: PASSED"
  echo ""
  echo "All required build and test operations completed successfully."

  return 0
}

################################################################################
# Module Dependency Groups
################################################################################

build_foundation() {

  log_section "PHASE 3 — FOUNDATION LAYER"

  local modules=(
    "001_FOUNDATION/Types"
    "001_FOUNDATION/Utilities"
    "001_FOUNDATION/ProtocolSpecs"
  )

  for module in "${modules[@]}"; do
    run_module "$module" || true
  done
}

build_llm_layer() {

  log_section "PHASE 4 — LLM ORCHESTRATION LAYER"

  local modules=(
    "002_LLM_GATEWAY/PromptEngine"
    "002_LLM_GATEWAY/ModelRouter"
    "002_LLM_GATEWAY/Guardrails"
    "002_LLM_GATEWAY/LyricsEngine"
  )

  for module in "${modules[@]}"; do
    run_module "$module" || true
  done
}

build_audio_layer() {

  log_section "PHASE 5 — AUDIO SYNTHESIS ENGINE"

  local modules=(
    "003_AUDIO_ENGINE/SynthEngine"
    "003_AUDIO_ENGINE/AudioRenderer"
    "003_AUDIO_ENGINE/MixMaster"
    "003_AUDIO_ENGINE/VoiceProfiler"
    "003_AUDIO_ENGINE/PhaseVocoder"
  )

  for module in "${modules[@]}"; do
    run_module "$module" || true
  done
}

build_composition_layer() {

  log_section "PHASE 6 — COMPOSITION AGENT"

  local modules=(
    "004_COMPOSITION_AGENT/SessionManager"
    "004_COMPOSITION_AGENT/CompositionMemory"
    "004_COMPOSITION_AGENT/TrackGenerator"
    "004_COMPOSITION_AGENT/GenerationPipeline"
  )

  for module in "${modules[@]}"; do
    run_module "$module" || true
  done
}

build_interface_layer() {

  log_section "PHASE 7 — INTERFACE & API GATEWAYS"

  local modules=(
    "005_INTERFACE/WebSockets"
    "005_INTERFACE/JitterBuffer"
    "005_INTERFACE/REST_API"
    "005_INTERFACE/WebUI"
  )

  for module in "${modules[@]}"; do
    run_module "$module" || true
  done
}

################################################################################
# Main Pipeline
################################################################################

main() {

  initialize_directories

  echo ""
  echo "╔══════════════════════════════════════════════════════════════════════╗"
  echo "║        ROUNSAVILLE AI MUSIC GENERATOR — MASTER PIPELINE             ║"
  echo "║                                                                      ║"
  echo "║  Build • Test • Audit • Coverage • Export • Archive • Report        ║"
  echo "║                                                                      ║"
  echo "║  Author: Joseph Michael Rounsaville                                ║"
  echo "╚══════════════════════════════════════════════════════════════════════╝"
  echo ""

  echo "Build ID: $BUILD_ID"
  echo "Start:    $START_TIMESTAMP"
  echo ""

  log_section "PIPELINE CONFIGURATION"

  echo "Verbose:       $VERBOSE"
  echo "Tests:         $RUN_TESTS"
  echo "Coverage:      $GENERATE_COVERAGE"
  echo "Clean:         $CLEAN_FIRST"
  echo "Audit:         $RUN_AUDIT"
  echo "Lint:          $RUN_LINT"
  echo "Typecheck:     $RUN_TYPECHECK"
  echo "Export:        $DOWNLOAD_ALL"
  echo "Archive:       $CREATE_ARCHIVE"
  echo "Parallel Jobs: $PARALLEL_JOBS"
  echo "Retries:       $MAX_RETRIES"
  echo "Timeout:       $COMMAND_TIMEOUT"
  echo "Dry Run:       $DRY_RUN"
  echo "CI Mode:       $CI_MODE"
  echo ""

  if ! detect_toolchain; then
    log_error "Environment validation failed."
    exit 3
  fi

  capture_environment
  capture_git_metadata

  if ! validate_repository; then
    log_error "Repository validation failed."
    exit 4
  fi

  build_foundation

  build_llm_layer

  build_audio_layer

  build_composition_layer

  build_interface_layer

  log_section "PHASE 8 — CROSS-LANGUAGE INTEGRATION TESTS"

  run_python_tests || true

  log_section "PHASE 9 — ARTIFACT INVENTORY"

  generate_artifact_inventory

  if [[ "$DOWNLOAD_ALL" == true ]]; then

    log_section "PHASE 10 — COMPLETE TREE EXPORT"

    download_all_files

  fi

  if [[ "$CREATE_ARCHIVE" == true ]]; then

    log_section "PHASE 11 — COMPLETE ARCHIVE"

    create_full_archive

  fi

  log_section "PHASE 12 — BUILD REPORT GENERATION"

  generate_json_report

  generate_markdown_report

  print_final_summary

  if [[ $? -eq 0 ]]; then
    exit 0
  else
    exit 1
  fi
}

################################################################################
# Signal Handling
################################################################################

cleanup_on_exit() {

  local exit_code=$?

  if [[ "$exit_code" -ne 0 ]]; then
    log_warning "Pipeline interrupted or terminated with exit code $exit_code."
  fi

}

trap cleanup_on_exit EXIT

trap '
  log_error "Pipeline interrupted by signal."
  exit 1
' INT TERM

################################################################################
# Execute Master Pipeline
################################################################################

main "$@"