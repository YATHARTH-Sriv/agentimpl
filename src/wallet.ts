import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount } from "@solana/spl-token";
import bs58 from "bs58";
import * as fs from "fs";
import * as path from "path";

const DEVNET_RPC = "https://api.devnet.solana.com";
const USDC_DEVNET_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export class AgentWallet {
  private keypair: Keypair;
  private connection: Connection;

  constructor(privateKeyBase58?: string) {
    if (privateKeyBase58) {
      // Load existing wallet
      const secretKey = bs58.decode(privateKeyBase58);
      this.keypair = Keypair.fromSecretKey(secretKey);
      console.log(`💰 Loaded wallet: ${this.publicKey}`);
    } else {
      // Generate new wallet
      this.keypair = Keypair.generate();
      console.log(`🆕 Generated new wallet: ${this.publicKey}`);
      console.log(`🔑 Private key (save this!):\n   ${this.privateKeyBase58}`);
    }
    this.connection = new Connection(DEVNET_RPC, "confirmed");
  }

  get publicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  get privateKeyBase58(): string {
    return bs58.encode(this.keypair.secretKey);
  }

  get publicKeyObj(): PublicKey {
    return this.keypair.publicKey;
  }

  getKeypair(): Keypair {
    return this.keypair;
  }

  async getBalance(): Promise<number> {
    const balance = await this.connection.getBalance(this.keypair.publicKey);
    return balance / LAMPORTS_PER_SOL;
  }

  async getUsdcBalance(): Promise<number> {
    try {
      const tokenAccount = await getAssociatedTokenAddress(
        USDC_DEVNET_MINT,
        this.keypair.publicKey
      );
      const account = await getAccount(this.connection, tokenAccount);
      return Number(account.amount) / 1_000_000; // USDC has 6 decimals
    } catch (error) {
      // Token account doesn't exist
      return 0;
    }
  }

  async requestAirdrop(amount: number = 1): Promise<string> {
    console.log(`🪂 Requesting ${amount} SOL airdrop...`);
    const signature = await this.connection.requestAirdrop(
      this.keypair.publicKey,
      amount * LAMPORTS_PER_SOL
    );
    await this.connection.confirmTransaction(signature);
    console.log(`✅ Airdrop confirmed: ${signature}`);
    return signature;
  }

  /**
   * Sign a message with the wallet
   */
  sign(message: Uint8Array): Uint8Array {
    return this.keypair.secretKey;
  }
}

export function loadOrCreateWallet(): AgentWallet {
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  
  if (privateKey && privateKey.length > 0) {
    return new AgentWallet(privateKey);
  }
  
  console.log("⚠️  No AGENT_PRIVATE_KEY found in .env");
  console.log("   Generating a new wallet for you...\n");
  
  const wallet = new AgentWallet();
  
  console.log("\n📝 Add this to your .env file:");
  console.log(`   AGENT_PRIVATE_KEY=${wallet.privateKeyBase58}\n`);
  
  return wallet;
}