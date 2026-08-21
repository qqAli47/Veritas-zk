const { buildPoseidon } = require("circomlibjs");

async function main() {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error("Usage: node scripts/generate_commitment.js <birthYear> <secret>");
    process.exit(1);
  }

  const [birthYear, secret] = args.map(BigInt);
  const poseidon = await buildPoseidon();
  const hash = poseidon([birthYear, secret]);
  const commitment = poseidon.F.toString(hash);

  console.log("Commitment (decimal):", commitment);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
