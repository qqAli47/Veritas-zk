#!/usr/bin/env bash
# =============================================================================
#  run.sh - one-command local setup and launch for Veritas-zk
#           (macOS / Linux companion to run.bat)
#
#  Usage:
#     ./run.sh            Full setup, then start the node + app
#     ./run.sh setup      Install dependencies and build the circuit, then stop
#     ./run.sh test       Run the test suite
#     ./run.sh demo       Narrated end-to-end run
#     ./run.sh clean      Delete build output and dependencies
#     ./run.sh help       Show this list
#
#  Safe to re-run. Steps that are already done are skipped.
# =============================================================================
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if [ -t 1 ]; then
  R=$'\e[0m'; DIM=$'\e[90m'; RED=$'\e[91m'; GREEN=$'\e[92m'
  YEL=$'\e[93m'; BLU=$'\e[94m'; PUR=$'\e[95m'; B=$'\e[1m'
else
  R=""; DIM=""; RED=""; GREEN=""; YEL=""; BLU=""; PUR=""; B=""
fi

STEP_N=0
step() { STEP_N=$((STEP_N + 1)); printf '\n%s[%d/7]%s %s%s%s\n' "$PUR" "$STEP_N" "$R" "$B" "$1" "$R"; }
ok()   { printf '   %s[ok]%s %s\n' "$GREEN" "$R" "$1"; }
skip() { printf '   %s[--] %s%s\n' "$DIM" "$1" "$R"; }
info() { printf '   %s%s%s\n' "$DIM" "$1" "$R"; }
warn() { printf '   %s[!]%s %s\n' "$YEL" "$R" "$1"; }
die()  { printf '\n   %s[X] %s%s\n\n' "$RED" "$1" "$R"; exit 1; }

port_busy() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1
  elif command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | grep -q ":$1 "
  else
    netstat -an 2>/dev/null | grep -q "[:.]$1 .*LISTEN"
  fi
}

wait_for_port() {
  for _ in $(seq 1 "$2"); do
    port_busy "$1" && return 0
    sleep 1
  done
  return 1
}

# Open a command in a new terminal window where we can, otherwise background it
# and tee to a log file.
spawn() {
  local title="$1" cmd="$2" log="$3"
  if [[ "$OSTYPE" == darwin* ]] && command -v osascript >/dev/null 2>&1; then
    osascript -e "tell application \"Terminal\" to do script \"cd '$PWD' && $cmd\"" >/dev/null
  elif command -v gnome-terminal >/dev/null 2>&1; then
    gnome-terminal --title="$title" -- bash -c "cd '$PWD' && $cmd; exec bash" >/dev/null 2>&1
  elif command -v x-terminal-emulator >/dev/null 2>&1; then
    x-terminal-emulator -e bash -c "cd '$PWD' && $cmd; exec bash" >/dev/null 2>&1
  else
    info "No terminal emulator found - running in the background, logging to $log"
    nohup bash -c "$cmd" > "$log" 2>&1 &
  fi
}

ACTION="${1:-start}"

printf '\n%s%s   ####  VERITAS-zk  ####%s\n' "$PUR" "$B" "$R"
printf '%s   Privacy-preserving age verification with zero-knowledge proofs%s\n' "$DIM" "$R"
printf '%s   ---------------------------------------------------------------%s\n' "$DIM" "$R"

case "$ACTION" in
  help)
    printf '\n   %srun.sh%s          Set everything up, then start the node and the app\n' "$B" "$R"
    printf '   %srun.sh setup%s    Install and build only - do not start anything\n' "$B" "$R"
    printf '   %srun.sh test%s     Run the 85-test suite\n' "$B" "$R"
    printf '   %srun.sh demo%s     Narrated end-to-end run, incl. 4 attacks being blocked\n' "$B" "$R"
    printf '   %srun.sh clean%s    Delete build output and dependencies\n' "$B" "$R"
    printf '   %srun.sh help%s     This list\n\n' "$B" "$R"
    exit 0
    ;;
  clean)
    warn "This deletes build output, dependencies and deployment records."
    read -r -p "   Are you sure? [y/N] " reply
    [[ "$reply" =~ ^[Yy]$ ]] || { echo "   Cancelled."; exit 0; }
    for d in build artifacts cache deployments node_modules frontend/node_modules \
             frontend/dist frontend/public/zk; do
      [ -e "$d" ] && { echo "   removing $d"; rm -rf "$d"; }
    done
    rm -f frontend/.env.local
    ok "Cleaned. Run ./run.sh to set everything up again."
    info "The Powers-of-Tau cache in .ptau-cache was kept."
    exit 0
    ;;
esac

# --- 1. Node.js -------------------------------------------------------------
step "Checking Node.js"
command -v node >/dev/null 2>&1 || die "Node.js is not installed. Get the LTS build from https://nodejs.org/"
NODE_MAJOR=$(node --version | sed 's/^v\([0-9]*\).*/\1/')
[ "$NODE_MAJOR" -ge 18 ] || die "Node $(node --version) is too old. Version 18 or newer is required."
ok "Node $(node --version)"

# --- 2. circom --------------------------------------------------------------
#
# Note: `npm install -g circom` installs version 0.5.46, the OLD pre-2.0
# compiler, which cannot build this circuit. So check the version, not just
# that the command exists.
step "Checking the circom compiler"
CIRCOM_OK=0
if command -v circom >/dev/null 2>&1; then
  CIRCOM_VER=$(circom --version 2>&1 | awk '{print $3}')
  if [[ "$CIRCOM_VER" == 2.* ]]; then
    CIRCOM_OK=1
    ok "circom $CIRCOM_VER"
  else
    warn "Found circom $CIRCOM_VER, but version 2.x is required."
    info "That is the old 'npm install -g circom' package. Remove it with:"
    info "  npm uninstall -g circom"
  fi
fi

if [ "$CIRCOM_OK" -eq 0 ]; then
  echo
  info "circom 2 was not found. It is a single binary with no installer."
  case "$OSTYPE" in
    darwin*)  ASSET="circom-macos-amd64" ;;
    linux*)   ASSET="circom-linux-amd64" ;;
    *)        ASSET="" ;;
  esac
  [ -n "$ASSET" ] || die "Unsupported platform. Install circom 2 from https://github.com/iden3/circom/releases/latest"

  read -r -p "   Download it automatically to /usr/local/bin? [y/N] " reply
  if [[ ! "$reply" =~ ^[Yy]$ ]]; then
    info "Manual install:"
    info "  1. Download $ASSET from https://github.com/iden3/circom/releases/latest"
    info "  2. chmod +x it, rename to 'circom', and put it on your PATH"
    exit 1
  fi

  TMP=$(mktemp)
  curl -L --fail --progress-bar -o "$TMP" \
    "https://github.com/iden3/circom/releases/latest/download/$ASSET" \
    || die "Download failed. Check your connection, or install manually."
  chmod +x "$TMP"
  if [ -w /usr/local/bin ]; then mv "$TMP" /usr/local/bin/circom
  else info "Needs sudo to write to /usr/local/bin"; sudo mv "$TMP" /usr/local/bin/circom; fi
  ok "circom $(circom --version 2>&1 | awk '{print $3}') installed"
fi

# --- 3. Dependencies --------------------------------------------------------
step "Installing dependencies"
if [ -d node_modules/hardhat ]; then
  skip "Root packages already installed"
else
  info "Installing root packages. First run takes a few minutes ..."
  npm install --no-audit --no-fund || die "npm install failed in the project root."
  ok "Root packages installed"
fi

if [ -d frontend/node_modules/vite ]; then
  skip "Frontend packages already installed"
else
  info "Installing frontend packages ..."
  (cd frontend && npm install --no-audit --no-fund) || die "npm install failed in frontend/."
  ok "Frontend packages installed"
fi

# --- 4. Circuit -------------------------------------------------------------
step "Building the ZK circuit"
if [ -f build/attribute_check_final.zkey ]; then
  skip "Circuit already built - use './run.sh clean' to force a rebuild"
else
  info "Compiling the circuit and running the trusted setup ..."
  info "Downloads a 5 MB ceremony file on first run. Takes 1-2 minutes."
  echo
  npm run zk:build || die "The circuit build failed. Scroll up for the compiler error."
  ok "Circuit built, verifier contract generated"
fi

# --- 5. Contracts -----------------------------------------------------------
step "Compiling the smart contracts"
npx hardhat compile || die "Contract compilation failed."
ok "Contracts compiled"

case "$ACTION" in
  setup)
    printf '\n%s%s   Setup complete.%s\n' "$GREEN" "$B" "$R"
    printf '   Run %s./run.sh%s to start the blockchain and the web app.\n\n' "$B" "$R"
    exit 0
    ;;
  test)
    echo; info "Running the test suite ..."; echo
    npx hardhat test
    exit $?
    ;;
  demo)
    port_busy 8545 || die "No blockchain is listening on port 8545. Start one with './run.sh'."
    npx hardhat run scripts/demo.js --network localhost
    exit $?
    ;;
esac

# --- 6. Blockchain ----------------------------------------------------------
step "Starting the local blockchain"
if port_busy 8545; then
  skip "A node is already listening on port 8545 - reusing it"
else
  spawn "Veritas - Hardhat node" "npx hardhat node" "/tmp/veritas-node.log"
  info "Waiting for the node to accept connections ..."
  wait_for_port 8545 45 || die "The blockchain did not start within 45 seconds."
  sleep 2
  ok "Blockchain running at http://127.0.0.1:8545 - chain id 31337"
fi

info "Deploying contracts ..."
npx hardhat run scripts/deploy.js --network localhost || die "Deployment failed."
ok "Contracts deployed, frontend/.env.local written"

# --- 7. Web app -------------------------------------------------------------
step "Starting the web app"
spawn "Veritas - Web app" "cd frontend && npm run dev" "/tmp/veritas-web.log"
info "Waiting for Vite ..."
wait_for_port 5173 30 || warn "Vite is taking longer than usual - check the log."

cat <<EOF

${GREEN}${B}   ===============  READY  ===============${R}

   ${B}App:${R}         ${BLU}http://localhost:5173${R}
   ${B}Blockchain:${R}  ${BLU}http://127.0.0.1:8545${R}   ${DIM}chain id 31337${R}

   ${YEL}Set up MetaMask before you start:${R}

     1. Add a network - RPC ${B}http://127.0.0.1:8545${R}, chain id ${B}31337${R}, symbol ETH
     2. Import two test accounts using the private keys the node printed:
          ${DIM}Account #0  ->  the ISSUER, can register credentials${R}
          ${DIM}Account #2  ->  the HOLDER, proves their age${R}

   ${YEL}Then, in the app:${R}
     ${DIM}Issuer${R} tab as account #0  ->  issue a credential, download the .json
     ${DIM}Prove${R}  tab as account #2  ->  import it, generate a proof, verify
     ${DIM}Restricted${R} tab            ->  you are through the gate

   ${DIM}New to the project? Read WALKTHROUGH.md${R}

EOF

if command -v open >/dev/null 2>&1; then open http://localhost:5173
elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:5173 >/dev/null 2>&1
fi
