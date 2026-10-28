@echo off
setlocal EnableDelayedExpansion
title Veritas-zk

REM ============================================================================
REM  run.bat - one-command local setup and launch for Veritas-zk
REM
REM  Usage:
REM     run.bat            Full setup, then start the node + app
REM     run.bat setup      Install dependencies and build the circuit, then stop
REM     run.bat test       Run the test suite
REM     run.bat demo       Run the narrated end-to-end demo
REM     run.bat clean      Delete build output and dependencies
REM     run.bat help       Show this list
REM
REM  Safe to re-run. Steps that are already done are skipped.
REM
REM  MAINTAINER NOTE: do not put round brackets in ECHO text inside an IF or
REM  FOR block. cmd parses the whole block before running it, so a bracket in
REM  the text closes the block early and the file fails to parse even on
REM  branches that never execute. Use dashes or commas instead.
REM ============================================================================

cd /d "%~dp0"

REM Capture the ESC character so the output can be coloured.
for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "C_RESET=%ESC%[0m"
set "C_DIM=%ESC%[90m"
set "C_RED=%ESC%[91m"
set "C_GREEN=%ESC%[92m"
set "C_YELLOW=%ESC%[93m"
set "C_BLUE=%ESC%[94m"
set "C_PURPLE=%ESC%[95m"
set "C_BOLD=%ESC%[1m"

set "ACTION=%~1"
if "%ACTION%"=="" set "ACTION=start"

echo.
echo %C_PURPLE%%C_BOLD%   ####  VERITAS-zk  ####%C_RESET%
echo %C_DIM%   Privacy-preserving age verification with zero-knowledge proofs%C_RESET%
echo %C_DIM%   ---------------------------------------------------------------%C_RESET%

if /i "%ACTION%"=="help"  goto :show_help
if /i "%ACTION%"=="clean" goto :do_clean

REM ============================================================================
REM  STEP 1 - Node.js
REM ============================================================================
call :step "1/7" "Checking Node.js"

where node >nul 2>&1
if errorlevel 1 goto :no_node

for /f "tokens=1 delims=v." %%a in ('node --version') do set "NODE_MAJOR=%%a"
for /f %%a in ('node --version') do set "NODE_FULL=%%a"
if !NODE_MAJOR! LSS 18 goto :old_node
call :ok "Node !NODE_FULL!"

REM ============================================================================
REM  STEP 2 - circom compiler
REM
REM  This one deserves care. "npm install -g circom" installs version 0.5.46,
REM  the OLD pre-2.0 compiler, which cannot build this circuit. The real
REM  circom 2 is a Rust binary from GitHub releases. So we check the version
REM  rather than merely checking that the command exists.
REM ============================================================================
call :step "2/7" "Checking the circom compiler"

set "CIRCOM_OK="
where circom >nul 2>&1
if errorlevel 1 goto :circom_missing

for /f "tokens=3" %%v in ('circom --version 2^>^&1') do set "CIRCOM_VER=%%v"
for /f "tokens=1 delims=." %%m in ("!CIRCOM_VER!") do set "CIRCOM_MAJOR=%%m"
if "!CIRCOM_MAJOR!"=="2" goto :circom_good

call :warn "Found circom !CIRCOM_VER!, but version 2.x is required."
call :info "That is almost certainly the old 'npm install -g circom' package."
call :info "Remove it with:  npm uninstall -g circom"
goto :circom_missing

:circom_good
call :ok "circom !CIRCOM_VER!"
goto :deps

:circom_missing
echo.
call :info "circom 2 was not found. It is a single .exe with no installer."
echo.
choice /c YN /n /m "   Download it automatically to C:\circom ? [Y/N] "
if errorlevel 2 goto :circom_manual

echo.
call :info "Downloading circom to C:\circom\circom.exe ..."
if not exist "C:\circom" mkdir "C:\circom"
curl -L --fail --progress-bar -o "C:\circom\circom.exe" "https://github.com/iden3/circom/releases/latest/download/circom-windows-amd64.exe"
if errorlevel 1 goto :circom_download_failed

REM Put it on the PATH for THIS window so setup can continue immediately.
set "PATH=C:\circom;!PATH!"
for /f "tokens=3" %%v in ('circom --version 2^>^&1') do set "CIRCOM_VER=%%v"
call :ok "circom !CIRCOM_VER! installed"
echo.
call :warn "C:\circom is on the PATH for this window only."
call :info "To make it permanent, run this once in an ADMIN terminal:"
call :info "  setx /M PATH \"%%PATH%%;C:\circom\""

REM ============================================================================
REM  STEP 3 - Dependencies
REM ============================================================================
:deps
call :step "3/7" "Installing dependencies"

if exist "node_modules\hardhat" goto :deps_root_done
call :info "Installing root packages. First run takes a few minutes ..."
call npm install --no-audit --no-fund
if errorlevel 1 goto :npm_root_failed
call :ok "Root packages installed"
goto :deps_frontend

:deps_root_done
call :skip "Root packages already installed"

:deps_frontend
if exist "frontend\node_modules\vite" goto :deps_frontend_done
call :info "Installing frontend packages ..."
pushd frontend
call npm install --no-audit --no-fund
set "NPM_RC=!errorlevel!"
popd
if not "!NPM_RC!"=="0" goto :npm_frontend_failed
call :ok "Frontend packages installed"
goto :circuit

:deps_frontend_done
call :skip "Frontend packages already installed"

REM ============================================================================
REM  STEP 4 - Circuit build and trusted setup
REM ============================================================================
:circuit
call :step "4/7" "Building the ZK circuit"

if exist "build\attribute_check_final.zkey" goto :circuit_done
call :info "Compiling the circuit and running the trusted setup ..."
call :info "Downloads a 5 MB ceremony file on first run. Takes 1-2 minutes."
echo.
call npm run zk:build
if errorlevel 1 goto :circuit_failed
call :ok "Circuit built, verifier contract generated"
goto :contracts

:circuit_done
call :skip "Circuit already built - use 'run.bat clean' to force a rebuild"

REM ============================================================================
REM  STEP 5 - Contracts
REM ============================================================================
:contracts
call :step "5/7" "Compiling the smart contracts"
call npx hardhat compile
if errorlevel 1 goto :contracts_failed
call :ok "Contracts compiled"

if /i "%ACTION%"=="setup" goto :setup_done
if /i "%ACTION%"=="test"  goto :do_test
if /i "%ACTION%"=="demo"  goto :do_demo

REM ============================================================================
REM  STEP 6 - Local blockchain
REM ============================================================================
call :step "6/7" "Starting the local blockchain"

REM Reuse an existing node rather than failing on a port clash.
call :port_check 8545
if "!PORT_BUSY!"=="1" goto :node_reuse

start "Veritas - Hardhat node" cmd /k "npx hardhat node"
call :info "Waiting for the node to accept connections ..."
call :wait_for_port 8545 45
if not "!PORT_BUSY!"=="1" goto :node_failed
REM Give it a moment past the port opening to finish initialising accounts.
ping -n 3 127.0.0.1 >nul
call :ok "Blockchain running at http://127.0.0.1:8545 - chain id 31337"
goto :deploy

:node_reuse
call :skip "A node is already listening on port 8545 - reusing it"

:deploy
call :info "Deploying contracts ..."
call npx hardhat run scripts/deploy.js --network localhost
if errorlevel 1 goto :deploy_failed
call :ok "Contracts deployed, frontend\.env.local written"

REM ============================================================================
REM  STEP 7 - Web app
REM ============================================================================
call :step "7/7" "Starting the web app"
start "Veritas - Web app" cmd /k "cd /d %~dp0frontend && npm run dev"
call :info "Waiting for Vite ..."
call :wait_for_port 5173 30

echo.
echo %C_GREEN%%C_BOLD%   ===============  READY  ===============%C_RESET%
echo.
echo    %C_BOLD%App:%C_RESET%         %C_BLUE%http://localhost:5173%C_RESET%
echo    %C_BOLD%Blockchain:%C_RESET%  %C_BLUE%http://127.0.0.1:8545%C_RESET%   %C_DIM%chain id 31337%C_RESET%
echo.
echo    %C_YELLOW%Set up MetaMask before you start:%C_RESET%
echo.
echo      1. Add a network - RPC %C_BOLD%http://127.0.0.1:8545%C_RESET%, chain id %C_BOLD%31337%C_RESET%, symbol ETH
echo      2. Import two test accounts using the private keys printed in the
echo         %C_BOLD%Veritas - Hardhat node%C_RESET% window:
echo           %C_DIM%Account #0  ->  the ISSUER, can register credentials%C_RESET%
echo           %C_DIM%Account #2  ->  the HOLDER, proves their age%C_RESET%
echo.
echo    %C_YELLOW%Then, in the app:%C_RESET%
echo      %C_DIM%Issuer%C_RESET% tab as account #0  ->  issue a credential, download the .json
echo      %C_DIM%Prove%C_RESET%  tab as account #2  ->  import it, generate a proof, verify
echo      %C_DIM%Restricted%C_RESET% tab            ->  you are through the gate
echo.
echo    %C_DIM%New to the project? Read WALKTHROUGH.md%C_RESET%
echo    %C_DIM%Closing THIS window stops nothing. Close the two other windows%C_RESET%
echo    %C_DIM%to shut down the blockchain and the web app.%C_RESET%
echo.

choice /c YN /n /m "   Open the app in your browser now? [Y/N] "
if not errorlevel 2 start "" "http://localhost:5173"
echo.
goto :end

REM ============================================================================
REM  Alternate actions
REM ============================================================================

:setup_done
echo.
echo %C_GREEN%%C_BOLD%   Setup complete.%C_RESET%
echo    Run %C_BOLD%run.bat%C_RESET% to start the blockchain and the web app.
echo.
goto :end

:do_test
echo.
call :info "Running the test suite ..."
echo.
call npx hardhat test
echo.
goto :end

:do_demo
echo.
call :port_check 8545
if "!PORT_BUSY!"=="1" goto :demo_run
call :fail "No blockchain is listening on port 8545."
call :info "Start one first with 'run.bat', or run 'npx hardhat node' in a terminal."
goto :die

:demo_run
call npx hardhat run scripts/demo.js --network localhost
echo.
goto :end

:do_clean
echo.
call :warn "This deletes build output, dependencies and deployment records."
choice /c YN /n /m "   Are you sure? [Y/N] "
if errorlevel 2 goto :clean_cancelled
echo.
for %%d in (build artifacts cache deployments node_modules frontend\node_modules frontend\dist frontend\public\zk) do call :rmdir_if_present "%%d"
if exist "frontend\.env.local" del /q "frontend\.env.local"
echo.
call :ok "Cleaned. Run 'run.bat' to set everything up again."
call :info "The Powers-of-Tau cache in .ptau-cache was kept, so the next"
call :info "build will not have to download it again."
echo.
goto :end

:clean_cancelled
echo    Cancelled.
goto :end

:show_help
echo.
echo    %C_BOLD%run.bat%C_RESET%          Set everything up, then start the node and the app
echo    %C_BOLD%run.bat setup%C_RESET%    Install and build only - do not start anything
echo    %C_BOLD%run.bat test%C_RESET%     Run the 85-test suite
echo    %C_BOLD%run.bat demo%C_RESET%     Narrated end-to-end run, incl. 4 attacks being blocked
echo    %C_BOLD%run.bat clean%C_RESET%    Delete build output and dependencies
echo    %C_BOLD%run.bat help%C_RESET%     This list
echo.
goto :end

REM ============================================================================
REM  Failure paths
REM ============================================================================

:no_node
call :fail "Node.js is not installed, or is not on your PATH."
echo.
call :info "Install the LTS build from https://nodejs.org/"
call :info "Then close this window, open a NEW terminal, and run this file again."
call :info "A new terminal is needed so it picks up the updated PATH."
goto :die

:old_node
call :fail "Node !NODE_FULL! is too old. Version 18 or newer is required."
call :info "Please upgrade from https://nodejs.org/"
goto :die

:circom_manual
echo.
call :info "Manual install:"
call :info "  1. Download circom-windows-amd64.exe from"
call :info "     https://github.com/iden3/circom/releases/latest"
call :info "  2. Rename it to circom.exe and put it in a folder, e.g. C:\circom"
call :info "  3. Add that folder to your PATH, then open a NEW terminal"
goto :die

:circom_download_failed
call :fail "Download failed. Check your internet connection, or install manually."
goto :die

:npm_root_failed
call :fail "npm install failed in the project root."
goto :die

:npm_frontend_failed
call :fail "npm install failed in frontend\."
goto :die

:circuit_failed
call :fail "The circuit build failed. Scroll up for the compiler error."
goto :die

:contracts_failed
call :fail "Contract compilation failed."
goto :die

:node_failed
call :fail "The blockchain did not start within 45 seconds."
call :info "Check the 'Veritas - Hardhat node' window for the error."
goto :die

:deploy_failed
call :fail "Deployment failed."
goto :die

REM ============================================================================
REM  Helpers
REM ============================================================================

:step
echo.
echo %C_PURPLE%[%~1]%C_RESET% %C_BOLD%%~2%C_RESET%
exit /b 0

:ok
echo    %C_GREEN%[ok]%C_RESET% %~1
exit /b 0

:skip
echo    %C_DIM%[--] %~1%C_RESET%
exit /b 0

:info
echo    %C_DIM%%~1%C_RESET%
exit /b 0

:warn
echo    %C_YELLOW%[!]%C_RESET% %~1
exit /b 0

:fail
echo.
echo    %C_RED%[X] %~1%C_RESET%
exit /b 0

:rmdir_if_present
if exist "%~1" echo    removing %~1
if exist "%~1" rmdir /s /q "%~1"
exit /b 0

REM  Sets PORT_BUSY=1 when something is LISTENING on the given TCP port.
:port_check
set "PORT_BUSY="
for /f %%p in ('netstat -ano -p tcp ^| findstr /c:"LISTENING" ^| findstr /c:":%~1 " ^| find /c /v ""') do set "PORT_HITS=%%p"
if not "!PORT_HITS!"=="0" set "PORT_BUSY=1"
exit /b 0

REM  Polls a port for up to N seconds. %1 = port, %2 = seconds.
:wait_for_port
set "WAIT_LEFT=%~2"
:wait_loop
call :port_check %~1
if "!PORT_BUSY!"=="1" exit /b 0
set /a WAIT_LEFT-=1
if !WAIT_LEFT! LEQ 0 exit /b 1
ping -n 2 127.0.0.1 >nul
goto :wait_loop

:die
echo.
echo %C_DIM%   ---------------------------------------------------------------%C_RESET%
echo %C_RED%   Setup stopped.%C_RESET% Fix the problem above, then run this file again.
echo.
pause
exit /b 1

:end
if /i not "%ACTION%"=="start" pause
exit /b 0
