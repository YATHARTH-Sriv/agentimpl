export interface MarketplaceInfo {
  marketplace: string;
  version: string;
  currency: string;
  network: string;
  pricePerImage: string;
  features: string[];
  endpoints: Record<string, string>;
  howItWorks: string[];
}

export interface ImageInfo {
  success: boolean;
  image: {
    id: number;
    title: string;
    price: number;
    format: string;
    purchases: number;
    creator: string;
  };
  purchase: {
    method: string;
    endpoint: string;
    paymentRequired: boolean;
    amount: string;
    network: string;
  };
}

export interface BrowseResult {
  success: boolean;
  totalImages: number;
  images: Array<{
    id: number;
    title: string;
    price: number;
    purchases: number;
    buyEndpoint: string;
  }>;
}

export interface X402Challenge {
  x402Version: number;
  error: string;
  accepts: Array<{
    scheme: string;
    network: string;
    maxAmountRequired: string;
    resource: string;
    description: string;
    mimeType: string;
    payTo: string;
    maxTimeoutSeconds: number;
    asset: string;
    extra?: {
      feePayer?: string;
    };
  }>;
}

export interface PurchaseResult {
  success: boolean;
  transaction: {
    hash: string;
    amount: number;
    currency: string;
    network: string;
  };
  image: {
    id: number;
    title: string;
    url: string;
    price: number;
    format: string;
    license: string;
  };
  creator: {
    id: number;
    name: string;
    email: string;
    earnedThisSale: number;
    totalEarnings: number;
  };
}

export class PinspireClient {
  private baseUrl: string;
  private agentId: string;

  constructor(baseUrl: string, agentId: string = "autonomous-agent-v1") {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.agentId = agentId;
  }

  private async fetch(endpoint: string, options?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${endpoint}`;
    return fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "x-agent-address": this.agentId,
        ...options?.headers,
      },
    });
  }

  /**
   * Get marketplace information
   */
  async getMarketplaceInfo(): Promise<MarketplaceInfo> {
    const response = await this.fetch("/api/agent/info");
    if (!response.ok) {
      throw new Error(`Failed to get marketplace info: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Browse available images
   */
  async browseImages(): Promise<BrowseResult> {
    const response = await this.fetch("/api/agent/info?action=browse");
    if (!response.ok) {
      throw new Error(`Failed to browse images: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Get details for a specific image
   */
  async getImageInfo(imageId: number): Promise<ImageInfo> {
    const response = await this.fetch(`/api/agent/info?imageId=${imageId}`);
    if (!response.ok) {
      throw new Error(`Failed to get image info: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Initiate a purchase - will return 402 with x402 challenge
   */
  async initiatePurchase(imageId: number): Promise<{ status: number; data: X402Challenge | PurchaseResult }> {
    const response = await this.fetch(`/api/agent/buy?imageId=${imageId}`, {
      method: "POST",
    });
    
    const data = await response.json();
    return { status: response.status, data };
  }

  /**
   * Complete purchase with payment proof
   */
  async completePurchase(imageId: number, paymentHeader: string): Promise<PurchaseResult> {
    const response = await this.fetch(`/api/agent/buy?imageId=${imageId}`, {
      method: "POST",
      headers: {
        "X-PAYMENT": paymentHeader,
      },
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(`Purchase failed: ${JSON.stringify(error)}`);
    }
    
    return response.json();
  }
}
