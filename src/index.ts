import { config } from "dotenv";
import { loadOrCreateWallet } from "./wallet.js";
import { PinspireAgent } from "./agent.js";
import * as readline from "readline";

// Load environment variables
config();

function createReadlineInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║     🤖 PINSPIRE AI AGENT - TRAINING DATA BUYER 🤖          ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("\nInitializing agent...\n");

  // Check for --auto flag for non-interactive mode
  const autoMode = process.argv.includes("--auto");

  // Get API URL from args or environment (filter out flags)
  const args = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
  const apiUrl = args[0] || process.env.PINSPIRE_API_URL || "http://localhost:3000";
  const agentId = process.env.AGENT_ID || "autonomous-buyer-v1";

  // Load or create wallet
  const wallet = loadOrCreateWallet();

  // Check wallet balances
  try {
    const solBalance = await wallet.getBalance();
    const usdcBalance = await wallet.getUsdcBalance();
    
    console.log(`💰 Wallet Balances:`);
    console.log(`   SOL:  ${solBalance.toFixed(4)} SOL`);
    console.log(`   USDC: $${usdcBalance.toFixed(6)} USDC`);
    
    if (solBalance < 0.001) {
      console.log("\n⚠️  Low SOL balance. You need SOL for transaction fees.");
      console.log("   Get devnet SOL: https://faucet.solana.com/");
    }
    
    if (usdcBalance < 0.01) {
      console.log("\n⚠️  Low USDC balance. You need USDC to purchase images.");
    }
  } catch (error) {
    console.log("⚠️  Could not check balance (network issue?)");
  }

  // Create and run agent
  const agent = new PinspireAgent(wallet, {
    apiUrl,
    agentId,
    maxPurchases: 10,
  });

  if (autoMode) {
    console.log("\n🤖 Running in AUTO mode (non-interactive)...");
    await agent.run();
  } else {
    // Create readline interface for user input
    const rl = createReadlineInterface();
    try {
      await agent.runInteractive(rl, askQuestion);
    } finally {
      rl.close();
    }
  }

  console.log("\n🏁 Agent execution complete.\n");
}

// Run
main().catch((error) => {
  console.error("\n❌ Agent error:", error.message);
  process.exit(1);
});