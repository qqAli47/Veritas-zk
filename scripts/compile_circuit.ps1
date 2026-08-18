# compile_circuit.ps1
#
# Full pipeline: compile → trusted setup → proof generation
# Run from the project root: .\scripts\compile_circuit.ps1
#
# Prerequisites:
#   - circom CLI on PATH (circom --version prints 2.x.x)
#   - npm install already run (snarkjs, circomlib available)
#
# Output (all in build/, all gitignored):
#   attribute_check.r1cs
#   attribute_check.wasm  (inside attribute_check_js/)
#   circuit_0000.zkey     (before contribution)
#   circuit_final.zkey    (after contribution)
#   verification_key.json
#   proof.json
#   public.json

$ErrorActionPreference = "Stop"
$BUILD = "build"

# ── 0. Ensure build directory exists ──────────────────────────────────────────
if (-not (Test-Path $BUILD)) { New-Item -ItemType Directory -Path $BUILD | Out-Null }

# ── 1. Compile the circuit ─────────────────────────────────────────────────────
Write-Host "`n[1/7] Compiling AttributeCheck circuit..." -ForegroundColor Cyan
circom circuits/attribute_check.circom --r1cs --wasm --sym -o $BUILD -l node_modules
Write-Host "      Compiled successfully." -ForegroundColor Green

# ── 2. Powers of Tau (phase 1) ─────────────────────────────────────────────────
Write-Host "`n[2/7] Running Powers of Tau ceremony (phase 1)..." -ForegroundColor Cyan
npx snarkjs powersoftau new bn128 12 "$BUILD/pot12.ptau" -v
npx snarkjs powersoftau contribute "$BUILD/pot12.ptau" "$BUILD/pot12_0001.ptau" --name="Contributor 1" --entropy="veritas-zk-dev"
npx snarkjs powersoftau prepare phase2 "$BUILD/pot12_0001.ptau" "$BUILD/pot12_final.ptau" -v

# ── 3. Groth16 trusted setup (phase 2) ────────────────────────────────────────
Write-Host "`n[3/7] Groth16 circuit-specific setup..." -ForegroundColor Cyan
npx snarkjs groth16 setup "$BUILD/attribute_check.r1cs" "$BUILD/pot12_final.ptau" "$BUILD/circuit_0000.zkey"

# ── 4. Contribute to phase 2 ──────────────────────────────────────────────────
Write-Host "`n[4/7] Contributing to phase 2 zkey..." -ForegroundColor Cyan
npx snarkjs zkey contribute "$BUILD/circuit_0000.zkey" "$BUILD/circuit_final.zkey" --name="Contributor 1" --entropy="veritas-zk-dev"

# ── 5. Export verification key ────────────────────────────────────────────────
Write-Host "`n[5/7] Exporting verification key..." -ForegroundColor Cyan
npx snarkjs zkey export verificationkey "$BUILD/circuit_final.zkey" "$BUILD/verification_key.json"

# ── 6. Generate witness + proof ───────────────────────────────────────────────
Write-Host "`n[6/7] Generating witness and proof from circuits/input.json..." -ForegroundColor Cyan
node "$BUILD/attribute_check_js/generate_witness.js" `
     "$BUILD/attribute_check_js/attribute_check.wasm" `
     "circuits/input.json" `
     "$BUILD/witness.wtns"

npx snarkjs groth16 prove "$BUILD/circuit_final.zkey" "$BUILD/witness.wtns" "$BUILD/proof.json" "$BUILD/public.json"

# ── 7. Verify the proof ───────────────────────────────────────────────────────
Write-Host "`n[7/7] Verifying proof..." -ForegroundColor Cyan
npx snarkjs groth16 verify "$BUILD/verification_key.json" "$BUILD/public.json" "$BUILD/proof.json"

Write-Host "`n✅ All steps complete. Proof verified successfully." -ForegroundColor Green
Write-Host "   proof.json and public.json are in build/ (gitignored)" -ForegroundColor Gray
