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

