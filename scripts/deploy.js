/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  scripts/deploy.js — deploy and wire the whole Veritas system
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Deploys Groth16Verifier, CredentialRegistry, VeritasCore and the
 *  GatedContent demo, wires the roles, then writes:
 *
 *    deployments/<network>.json   addresses + provenance, for tooling
 *    frontend/.env.local          the same addresses, for Vite
 *
 *  Copying addresses by hand between a terminal and a .env file is how demos
 *  break, so the script does it.
 *
 *  Usage:
 *    npx hardhat run scripts/deploy.js --network localhost
 *    npx hardhat run scripts/deploy.js --network sepolia
 */

const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

/** Default policy. 30-day epochs; the reference year comes from the chain clock. */
const POLICY = {
  minAge: 18,
  epochSeconds: 30 * 24 * 3600,
  maxYearLag: 1,
  yearOverride: 0,
  paused: false,
};

const line = (s = '') => console.log(s);

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  const issuer = process.env.ISSUER_ADDRESS || deployer.address;

  line();
  line('  Veritas-zk deployment');
  line('  ' + '─'.repeat(60));
  line(`  network   ${network.name} (chainId ${(await ethers.provider.getNetwork()).chainId})`);
  line(`  deployer  ${deployer.address}`);
  line(`  balance   ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);
  line(`  issuer    ${issuer}`);
  line();

  // ── Pre-flight: the verifier must match the built circuit ────────────────
  const vkeyPath = path.join(BUILD, 'verification_key.json');
  if (!fs.existsSync(vkeyPath)) {
    throw new Error('build/verification_key.json is missing. Run `npm run zk:build` first.');
  }
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'circuits', 'public_signals.json'), 'utf8'),
  );
  if (vkey.nPublic !== manifest.nPublic) {
    throw new Error(
      `Verification key declares ${vkey.nPublic} public signals but the circuit manifest says ` +
        `${manifest.nPublic}. Re-run \`npm run zk:build\`.`,
    );
  }

  // ── 1. Verifier ──────────────────────────────────────────────────────────
  const verifier = await (await ethers.getContractFactory('Groth16Verifier')).deploy();
  await verifier.waitForDeployment();
  line(`  ✓ Groth16Verifier      ${await verifier.getAddress()}`);

  /*
   * SELF-TEST. The previous placeholder verifier returned `false`
   * unconditionally; deploying that and wiring it into an immutable would have
   * produced a permanently dead system with no obvious symptom. Prove a known-
   * good proof against the freshly deployed bytecode before trusting it.
   */
  const proofPath = path.join(BUILD, 'proof.json');
  const publicPath = path.join(BUILD, 'public.json');
  if (fs.existsSync(proofPath) && fs.existsSync(publicPath)) {
    const snarkjs = require('snarkjs');
    const raw = await snarkjs.groth16.exportSolidityCallData(
      JSON.parse(fs.readFileSync(proofPath, 'utf8')),
      JSON.parse(fs.readFileSync(publicPath, 'utf8')),
    );
    const [a, b, c, pub] = JSON.parse('[' + raw + ']');
    if (!(await verifier.verifyProof(a, b, c, pub))) {
      throw new Error(
        'The deployed verifier rejected a known-good proof. The .zkey and the ' +
          'generated contract are out of sync — re-run `npm run zk:build`.',
      );
    }
    line('    └ self-test passed: the deployed verifier accepts a known-good proof');
  } else {
    line('    └ ⚠ no sample proof in build/; skipping the verifier self-test');
  }

  // ── 2. Registry ──────────────────────────────────────────────────────────
  const registry = await (
    await ethers.getContractFactory('CredentialRegistry')
  ).deploy(deployer.address, issuer);
  await registry.waitForDeployment();
  line(`  ✓ CredentialRegistry   ${await registry.getAddress()}`);

  // ── 3. Core ──────────────────────────────────────────────────────────────
  const core = await (
    await ethers.getContractFactory('VeritasCore')
  ).deploy(
    await verifier.getAddress(),
    await registry.getAddress(),
    deployer.address,
    POLICY,
  );
  await core.waitForDeployment();
  line(`  ✓ VeritasCore          ${await core.getAddress()}`);

  // ── 4. Demo relying party ────────────────────────────────────────────────
  const gated = await (
    await ethers.getContractFactory('GatedContent')
  ).deploy(await core.getAddress(), POLICY.minAge);
  await gated.waitForDeployment();
  line(`  ✓ GatedContent (demo)  ${await gated.getAddress()}`);

  // ── 5. Persist ───────────────────────────────────────────────────────────
  const deployBlock = (await ethers.provider.getBlockNumber());
  const record = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployBlock,
    deployer: deployer.address,
    issuer,
    policy: POLICY,
    circuit: {
      nPublic: manifest.nPublic,
      order: manifest.order,
      r1csSha256: manifest.r1csSha256,
    },
    contracts: {
      verifier: await verifier.getAddress(),
      registry: await registry.getAddress(),
      core: await core.getAddress(),
      gatedContent: await gated.getAddress(),
    },
  };

  const deployDir = path.join(ROOT, 'deployments');
  fs.mkdirSync(deployDir, { recursive: true });
  fs.writeFileSync(
    path.join(deployDir, `${network.name}.json`),
    JSON.stringify(record, null, 2) + '\n',
  );

  const explorer =
    record.chainId === 11155111 ? 'https://sepolia.etherscan.io' : '';
  fs.writeFileSync(
    path.join(ROOT, 'frontend', '.env.local'),
    [
      '# Generated by scripts/deploy.js — do not edit by hand.',
      `# ${record.deployedAt}`,
      '',
      `VITE_CORE_ADDRESS=${record.contracts.core}`,
      `VITE_REGISTRY_ADDRESS=${record.contracts.registry}`,
      `VITE_VERIFIER_ADDRESS=${record.contracts.verifier}`,
      `VITE_GATED_ADDRESS=${record.contracts.gatedContent}`,
      `VITE_CHAIN_ID=${record.chainId}`,
      `VITE_NETWORK_NAME=${record.network}`,
      `VITE_DEPLOY_BLOCK=${deployBlock}`,
      `VITE_EXPLORER_URL=${explorer}`,
      '',
    ].join('\n'),
  );

  // ── 6. Publish ABIs the frontend needs ───────────────────────────────────
  const abiDir = path.join(ROOT, 'frontend', 'src', 'contracts', 'abis');
  fs.mkdirSync(abiDir, { recursive: true });
  for (const name of ['VeritasCore', 'CredentialRegistry', 'Groth16Verifier', 'GatedContent']) {
    const artifact = await hre.artifacts.readArtifact(name);
    // Strip bytecode — the frontend only ever needs the ABI, and the full
    // artifact is a few hundred KB of noise per contract.
    fs.writeFileSync(
      path.join(abiDir, `${name}.json`),
      JSON.stringify({ contractName: name, abi: artifact.abi }, null, 2) + '\n',
    );
  }

  line();
  line(`  deployments/${network.name}.json written`);
  line('  frontend/.env.local written');
  line('  frontend/src/contracts/abis/*.json refreshed');

  if (explorer) {
    line();
    line('  Etherscan:');
    for (const [k, v] of Object.entries(record.contracts)) {
      line(`    ${k.padEnd(13)} ${explorer}/address/${v}`);
    }
    line();
    line('  Verify the source with:');
    line(`    npx hardhat verify --network ${network.name} ${record.contracts.verifier}`);
  }
  line();
}

main().catch((error) => {
  console.error('\n  Deployment failed:', error.message, '\n');
  process.exitCode = 1;
});
