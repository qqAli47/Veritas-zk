/**
 * Simple deploy script for CredentialRegistry and Verifier (placeholder).
 */
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);

  const Registry = await hre.ethers.getContractFactory("CredentialRegistry");
  const registry = await Registry.deploy();
  await registry.waitForDeployment();
  console.log("CredentialRegistry deployed to:", registry.target);

  const Verifier = await hre.ethers.getContractFactory("Verifier");
  const verifier = await Verifier.deploy();
  await verifier.waitForDeployment();
  console.log("Verifier (placeholder) deployed to:", verifier.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
