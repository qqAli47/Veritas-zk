# Veritas-zk
A Privacy-Preserving Attribute Verification System Using ZK proofs

## Quickstart (scaffold)

These steps are intended for the contributor who takes the initial scaffold issue.

```bash
# initialize project
npm init -y

# install core dev deps
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox ethers snarkjs

# initialize hardhat (follow interactive prompts)
npx hardhat

# create folders (if not already present)
mkdir circuits contracts frontend scripts tests docs

# run tests
npm run test
```


Security: never commit `.env`, `.zkey`, `.wtns`, or private keys. Use `.gitignore` and CI artifacts for built circuit outputs.

## Running the Frontend

```bash
cd frontend
npm install
npm run dev
# Opens at http://localhost:5173
```

The frontend is a Vite + React app. On first run:
1. **Connect your wallet** — click "Connect Wallet" to link MetaMask
2. **Prove your age** — enter your birth year and a secret salt, then generate a ZK proof
3. **Access restricted content** — after successful verification, view the gated area

### Environment Variables

Copy `frontend/.env.example` to `frontend/.env` and fill in contract addresses after deployment:
```
VITE_CONTRACT_ADDRESS=0x...    # CredentialRegistry address
VITE_VERIFIER_ADDRESS=0x...    # Verifier address
```

