const { expect } = require("chai");

describe("CredentialRegistry", function () {
  it("deploys and registers a commitment", async function () {
    const [owner] = await ethers.getSigners();

    const Registry = await ethers.getContractFactory("CredentialRegistry");
    const registry = await Registry.deploy();
    await registry.waitForDeployment();

    const commitment = ethers.id("test-commitment");
    await registry.addCommitment(commitment);
    expect(await registry.isRegistered(commitment)).to.equal(true);
  });
});
