import { 
  Keypair, 
  Connection, 
  PublicKey, 
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import { 
  getAssociatedTokenAddress, 
  getAccount,
  createTransferCheckedInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import type { X402Challenge } from "./api-client.js";

const DEVNET_RPC = "https://api.devnet.solana.com";

// USDC token mint address on Solana devnet
const USDC_DEVNET_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export interface PaymentProof {
  header: string;
  transactionHash: string;
}

export class X402PaymentHandler {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(DEVNET_RPC, "confirmed");
  }

  /**
   * Parse x402 challenge from 402 response
   */
  parseChallenge(challenge: X402Challenge): {
    payTo: string;
    amount: number;
    amountRaw: string;
    network: string;
    asset: string;
    resource: string;
    scheme: string;
    maxTimeoutSeconds: number;
    x402Version: number;
    feePayer?: string;
  } {
    const accept = challenge.accepts[0];
    if (!accept) {
      throw new Error("No payment option in x402 challenge");
    }

    return {
      payTo: accept.payTo,
      amount: parseInt(accept.maxAmountRequired) / 1_000_000,
      amountRaw: accept.maxAmountRequired,
      network: accept.network,
      asset: accept.asset,
      resource: accept.resource,
      scheme: accept.scheme,
      maxTimeoutSeconds: accept.maxTimeoutSeconds,
      x402Version: challenge.x402Version,
      feePayer: accept.extra?.feePayer,
    };
  }


  async getUsdcTokenAccount(owner: PublicKey): Promise<PublicKey> {
    return getAssociatedTokenAddress(USDC_DEVNET_MINT, owner);
  }

  
  async getUsdcBalance(owner: PublicKey): Promise<number> {
    try {
      const tokenAccount = await this.getUsdcTokenAccount(owner);
      const account = await getAccount(this.connection, tokenAccount);
      return Number(account.amount) / 1_000_000;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Create x402 payment header
   * 
   * This creates a partially signed transaction that the x402 facilitator
   * will verify and then broadcast (adding their fee payer signature)
   */
  async createPayment(
    keypair: Keypair,
    challenge: X402Challenge
  ): Promise<PaymentProof> {
    const parsed = this.parseChallenge(challenge);
    
    console.log(`\n💳 Processing x402 Payment:`);
    console.log(`   Pay To: ${parsed.payTo}`);
    console.log(`   Amount: $${parsed.amount.toFixed(6)} USDC`);
    console.log(`   Network: ${parsed.network}`);
    console.log(`   Scheme: ${parsed.scheme}`);

    // Check USDC balance
    const balance = await this.getUsdcBalance(keypair.publicKey);
    console.log(`\n   💰 Your USDC Balance: $${balance.toFixed(6)}`);

    if (balance < parsed.amount) {
      throw new Error(`Insufficient USDC balance. Have: $${balance.toFixed(6)}, Need: $${parsed.amount.toFixed(6)}`);
    }

    // Get token accounts
    const senderTokenAccount = await this.getUsdcTokenAccount(keypair.publicKey);
    const recipientPubkey = new PublicKey(parsed.payTo);
    const recipientTokenAccount = await getAssociatedTokenAddress(USDC_DEVNET_MINT, recipientPubkey);

    // Amount in USDC base units (6 decimals)
    const amountInBaseUnits = BigInt(parsed.amountRaw);

    // Fee payer is the x402 facilitator (they will co-sign)
    const feePayerPubkey = parsed.feePayer 
      ? new PublicKey(parsed.feePayer)
      : keypair.publicKey;

    console.log(`\n   📡 Creating x402 transaction...`);
    console.log(`   Sender token: ${senderTokenAccount.toBase58().slice(0, 20)}...`);
    console.log(`   Recipient token: ${recipientTokenAccount.toBase58().slice(0, 20)}...`);
    console.log(`   Fee payer: ${feePayerPubkey.toBase58().slice(0, 20)}...`);

    // Create compute budget instructions (required by x402)
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: 1, // 1 microlamport priority fee
    });
    
    const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 100000, // Reasonable limit for token transfer
    });

    // Create transfer instruction with transferChecked
    const transferIx = createTransferCheckedInstruction(
      senderTokenAccount,
      USDC_DEVNET_MINT,
      recipientTokenAccount,
      keypair.publicKey,
      amountInBaseUnits,
      6, // USDC decimals
      [],
      TOKEN_PROGRAM_ID
    );

    // Get latest blockhash
    const { blockhash } = await this.connection.getLatestBlockhash("confirmed");

    // Create versioned transaction message
    const messageV0 = new TransactionMessage({
      payerKey: feePayerPubkey,
      recentBlockhash: blockhash,
      instructions: [computeLimitIx, computeBudgetIx, transferIx],
    }).compileToV0Message();

    // Create versioned transaction
    const transaction = new VersionedTransaction(messageV0);

    // Sign with our keypair (partial signature)
    // The fee payer (x402 facilitator) will add their signature when settling
    transaction.sign([keypair]);

    console.log(`   🔐 Transaction signed by agent`);
    console.log(`   📝 Awaiting x402 facilitator settlement...`);

    // Serialize transaction to base64
    const serializedTx = Buffer.from(transaction.serialize()).toString("base64");

    // Create x402 payment payload in the exact format expected
    const paymentPayload = {
      x402Version: parsed.x402Version,
      scheme: parsed.scheme,
      network: parsed.network,
      payload: {
        transaction: serializedTx,
      },
    };

    // Base64 encode the entire payment payload for the X-PAYMENT header
    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

    console.log(`\n   ✅ Payment header created`);
    console.log(`   📦 Header size: ${paymentHeader.length} bytes`);

    return {
      header: paymentHeader,
      transactionHash: "pending-settlement",
    };
  }

  /**
   * Check SOL balance for transaction fees
   */
  async getSolBalance(publicKey: PublicKey): Promise<number> {
    const balance = await this.connection.getBalance(publicKey);
    return balance / 1_000_000_000;
  }
}
