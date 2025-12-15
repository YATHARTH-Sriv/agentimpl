/**
 * Autonomous AI Agent for Pinspire Marketplace
 * 
 * This agent can:
 * 1. Discover the marketplace
 * 2. Browse available training datasets
 * 3. Select images to purchase (interactively)
 * 4. Complete x402 payments via facilitator
 * 5. Download purchased images
 */

import { PinspireClient, type BrowseResult, type X402Challenge } from "./api-client.js";
import { AgentWallet } from "./wallet.js";
import { X402PaymentHandler } from "./x402-handler.js";
import type * as readline from "readline";

export interface AgentConfig {
  apiUrl: string;
  agentId: string;
  maxPurchases?: number;
  targetCategories?: string[];
}

interface ImageItem {
  id: number;
  title: string;
  price: number;
  purchases: number;
  buyEndpoint: string;
}

export class PinspireAgent {
  private client: PinspireClient;
  private wallet: AgentWallet;
  private paymentHandler: X402PaymentHandler;
  private config: AgentConfig;
  private purchaseCount: number = 0;
  private purchasedImages: Array<{ id: number; title: string; success: boolean; txHash?: string }> = [];

  constructor(wallet: AgentWallet, config: AgentConfig) {
    this.wallet = wallet;
    this.config = config;
    this.client = new PinspireClient(config.apiUrl, config.agentId);
    this.paymentHandler = new X402PaymentHandler();
  }

  /**
   * Run the agent in interactive mode - allows user to select images
   */
  async runInteractive(
    rl: readline.Interface,
    askQuestion: (rl: readline.Interface, question: string) => Promise<string>
  ): Promise<void> {
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║       🤖 PINSPIRE INTERACTIVE AI AGENT STARTING 🤖         ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    console.log(`🔗 Target: ${this.config.apiUrl}`);
    console.log(`🆔 Agent ID: ${this.config.agentId}`);
    console.log(`💰 Wallet: ${this.wallet.publicKey}`);

    // Step 1: Discover marketplace
    await this.discoverMarketplace();

    // Step 2: Browse available images
    const images = await this.browseAvailableImages();

    if (!images || images.totalImages === 0) {
      console.log("\n⚠️  No images available for purchase. Exiting.");
      return;
    }

    // Step 3: Interactive purchase loop
    let continueLoop = true;
    while (continueLoop) {
      // Display menu
      console.log("\n────────────────────────────────────────────────────────────");
      console.log("📋 AVAILABLE IMAGES FOR PURCHASE:");
      console.log("────────────────────────────────────────────────────────────");
      
      images.images.forEach((img, i) => {
        const purchased = this.purchasedImages.find(p => p.id === img.id && p.success);
        const status = purchased ? " ✅ (purchased)" : "";
        console.log(`   ${i + 1}. [ID:${img.id}] "${img.title}" - $${img.price} USDC${status}`);
      });
      
      console.log("\n   0. Exit agent");
      console.log("────────────────────────────────────────────────────────────");

      const answer = await askQuestion(rl, "\n🎯 Enter the number of the image you want to buy (or 0 to exit): ");
      const selection = parseInt(answer, 10);

      if (isNaN(selection)) {
        console.log("❌ Invalid input. Please enter a number.");
        continue;
      }

      if (selection === 0) {
        console.log("\n👋 Exiting purchase mode...");
        continueLoop = false;
        continue;
      }

      if (selection < 1 || selection > images.images.length) {
        console.log(`❌ Invalid selection. Please enter a number between 1 and ${images.images.length}.`);
        continue;
      }

      const selectedImage = images.images[selection - 1];
      
      // Confirm purchase
      console.log(`\n📦 Selected: "${selectedImage.title}" (ID: ${selectedImage.id})`);
      console.log(`💵 Price: $${selectedImage.price} USDC`);
      
      const confirm = await askQuestion(rl, "\n⚡ Confirm purchase? (y/n): ");
      
      if (confirm.toLowerCase() !== 'y' && confirm.toLowerCase() !== 'yes') {
        console.log("❌ Purchase cancelled.");
        continue;
      }

      // Execute purchase
      const result = await this.purchaseImage(selectedImage.id);
      this.purchasedImages.push({
        id: selectedImage.id,
        title: selectedImage.title,
        success: result.success,
        txHash: result.txHash,
      });

      if (this.purchaseCount >= (this.config.maxPurchases || 10)) {
        console.log(`\n⚠️  Reached maximum purchase limit (${this.config.maxPurchases}).`);
        continueLoop = false;
      } else {
        const another = await askQuestion(rl, "\n🛒 Would you like to purchase another image? (y/n): ");
        if (another.toLowerCase() !== 'y' && another.toLowerCase() !== 'yes') {
          continueLoop = false;
        }
      }
    }

    // Summary
    this.printSummary();
  }

  /**
   * Run the agent's main loop (original non-interactive mode)
   */
  async run(): Promise<void> {
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║       🤖 PINSPIRE AUTONOMOUS AI AGENT STARTING 🤖          ║");
    console.log("╚════════════════════════════════════════════════════════════╝\n");

    console.log(`🔗 Target: ${this.config.apiUrl}`);
    console.log(`🆔 Agent ID: ${this.config.agentId}`);
    console.log(`💰 Wallet: ${this.wallet.publicKey}`);

    await this.discoverMarketplace();
    const images = await this.browseAvailableImages();

    if (!images || images.totalImages === 0) {
      console.log("\n⚠️  No images available for purchase. Exiting.");
      return;
    }

    const targetImage = images.images[0];
    console.log(`\n🎯 Selected target: "${targetImage.title}" (ID: ${targetImage.id})`);

    await this.purchaseImage(targetImage.id);
    this.printSummary();
  }

  private async discoverMarketplace(): Promise<void> {
    console.log("\n────────────────────────────────────────────────────────────");
    console.log("📡 PHASE 1: Marketplace Discovery");
    console.log("────────────────────────────────────────────────────────────");

    try {
      const info = await this.client.getMarketplaceInfo();
      console.log(`✅ Connected to: ${info.marketplace}`);
      console.log(`   Version: ${info.version}`);
      console.log(`   Currency: ${info.currency}`);
      console.log(`   Network: ${info.network}`);
      console.log(`   Price per image: ${info.pricePerImage}`);
      console.log(`   Features: ${info.features.length} capabilities`);
    } catch (error) {
      console.log(`❌ Failed to connect: ${error}`);
      throw error;
    }
  }

  private async browseAvailableImages(): Promise<BrowseResult | null> {
    console.log("\n────────────────────────────────────────────────────────────");
    console.log("🔍 PHASE 2: Dataset Discovery");
    console.log("────────────────────────────────────────────────────────────");

    try {
      const result = await this.client.browseImages();
      console.log(`✅ Found ${result.totalImages} images available`);
      
      result.images.forEach((img, i) => {
        console.log(`   ${i + 1}. [ID:${img.id}] "${img.title}" - $${img.price} (${img.purchases} sales)`);
      });

      return result;
    } catch (error) {
      console.log(`❌ Browse failed: ${error}`);
      return null;
    }
  }

  private async purchaseImage(imageId: number): Promise<{ success: boolean; txHash?: string }> {
    console.log("\n────────────────────────────────────────────────────────────");
    console.log(`💳 PHASE 3: Processing Purchase (Image #${imageId})`);
    console.log("────────────────────────────────────────────────────────────");

    try {
      // Step 3a: Get image details
      console.log("\n📋 Fetching image details...");
      const imageInfo = await this.client.getImageInfo(imageId);
      console.log(`   Title: ${imageInfo.image.title}`);
      console.log(`   Creator: ${imageInfo.image.creator}`);
      console.log(`   Price: ${imageInfo.purchase.amount}`);

      // Step 3b: Initiate purchase (will get 402)
      console.log("\n🛒 Initiating purchase...");
      const { status, data } = await this.client.initiatePurchase(imageId);

      if (status === 402) {
        console.log("✅ Received x402 payment challenge");
        
        // Step 3c: Process payment via x402 facilitator
        const challenge = data as X402Challenge;
        const paymentProof = await this.paymentHandler.createPayment(
          this.wallet.getKeypair(),
          challenge
        );

        // Step 3d: Complete purchase with payment header
        console.log("\n🔄 Completing purchase with payment proof...");
        
        try {
          const result = await this.client.completePurchase(imageId, paymentProof.header);
          console.log("\n✅ PURCHASE COMPLETE!");
          console.log(`   Transaction: ${paymentProof.transactionHash.slice(0, 20)}...`);
          console.log(`   Image URL: ${result.image.url}`);
          console.log(`   Creator earned: $${result.creator.earnedThisSale}`);
          this.purchaseCount++;
          return { success: true, txHash: paymentProof.transactionHash };
        } catch (error: any) {
          console.log(`\n❌ Purchase failed: ${error.message}`);
          return { success: false, txHash: paymentProof.transactionHash };
        }
      } else if (status === 200) {
        console.log("✅ Purchase completed (no payment needed)");
        this.purchaseCount++;
        return { success: true };
      } else {
        console.log(`❌ Unexpected response: ${status}`);
        return { success: false };
      }
    } catch (error: any) {
      console.log(`❌ Purchase failed: ${error.message}`);
      return { success: false };
    }
  }

  private printSummary(): void {
    console.log("\n╔════════════════════════════════════════════════════════════╗");
    console.log("║                    📊 AGENT SUMMARY                        ║");
    console.log("╚════════════════════════════════════════════════════════════╝");
    
    const successfulPurchases = this.purchasedImages.filter(p => p.success);
    const failedPurchases = this.purchasedImages.filter(p => !p.success);
    
    console.log(`
   🤖 Agent: ${this.config.agentId}
   💰 Wallet: ${this.wallet.publicKey.slice(0, 20)}...
   
   📈 Purchase Statistics:
   • Total attempted: ${this.purchasedImages.length}
   • Successful: ${successfulPurchases.length}
   • Failed: ${failedPurchases.length}
`);

    if (this.purchasedImages.length > 0) {
      console.log("   📦 Purchase History:");
      this.purchasedImages.forEach((p, i) => {
        const status = p.success ? "✅" : "❌";
        console.log(`      ${i + 1}. ${status} [ID:${p.id}] "${p.title}"`);
      });
    }

    console.log(`
   🎯 x402 Protocol Flow:
   • Agent discovered marketplace and browsed datasets
   • User selected images interactively  
   • Agent received x402 payment challenge (HTTP 402)
   • Agent requested transaction from x402 facilitator
   • Agent signed transaction with Solana wallet
   • Facilitator verified and submitted payment
   • Server delivered purchased content
`);
  }
}