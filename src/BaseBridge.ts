/**
 * Base Bridge Utilities
 * Cross-chain bridge tools for seamless asset transfers to and from Base
 */

import { ethers } from 'ethers';

export interface BridgeConfig {
  sourceChain: number;
  targetChain: number;
  bridgeContract: string;
  tokenAddress: string;
  amount: string;
  recipient: string;
}

export interface BridgeStatus {
  transactionHash: string;
  status: 'pending' | 'confirmed' | 'failed';
  sourceChain: number;
  targetChain: number;
  amount: string;
  timestamp: number;
}

export interface GasEstimate {
  gasLimit: string;
  gasPrice: string;
  totalCost: string;
  estimatedTime: number; // in minutes
}

// Supported chains for bridging
export const SUPPORTED_CHAINS = {
  ETHEREUM: 1,
  BASE: 8453,
  OPTIMISM: 10,
  ARBITRUM: 42161,
  POLYGON: 137
} as const;

// Bridge contract addresses
export const BRIDGE_CONTRACTS = {
  [SUPPORTED_CHAINS.ETHEREUM]: {
    [SUPPORTED_CHAINS.BASE]: '0x3154Cf16ccdb4C6d922629664174b904d80F2C35',
    [SUPPORTED_CHAINS.OPTIMISM]: '0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1',
  },
  [SUPPORTED_CHAINS.BASE]: {
    [SUPPORTED_CHAINS.ETHEREUM]: '0x4200000000000000000000000000000000000010',
    [SUPPORTED_CHAINS.OPTIMISM]: '0x4200000000000000000000000000000000000007',
  }
};

// Common token addresses across chains
export const TOKEN_ADDRESSES = {
  USDC: {
    [SUPPORTED_CHAINS.ETHEREUM]: '0xA0b86a33E6441E6C673C5C9C7C5C5C5C5C5C5C5C',
    [SUPPORTED_CHAINS.BASE]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    [SUPPORTED_CHAINS.OPTIMISM]: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607',
  },
  WETH: {
    [SUPPORTED_CHAINS.ETHEREUM]: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    [SUPPORTED_CHAINS.BASE]: '0x4200000000000000000000000000000000000006',
    [SUPPORTED_CHAINS.OPTIMISM]: '0x4200000000000000000000000000000000000006',
  }
};

export class BaseBridge {
  private provider: ethers.Provider;
  private signer?: ethers.Signer;

  constructor(provider: ethers.Provider, signer?: ethers.Signer) {
    this.provider = provider;
    this.signer = signer;
  }

  /**
   * Estimate gas costs for a bridge transaction
   */
  async estimateGas(config: BridgeConfig): Promise<GasEstimate> {
    const bridgeAddress = BRIDGE_CONTRACTS[config.sourceChain]?.[config.targetChain];
    if (!bridgeAddress) {
      throw new Error(`Bridge not supported between chains ${config.sourceChain} and ${config.targetChain}`);
    }

    // Simplified gas estimation
    const gasLimit = '200000'; // Base bridge operations typically use ~150k gas
    const gasPrice = await this.provider.getFeeData();
    
    const totalCost = ethers.formatEther(
      BigInt(gasLimit) * (gasPrice.gasPrice || BigInt('20000000000'))
    );

    // Estimate time based on target chain
    let estimatedTime = 15; // Default 15 minutes
    if (config.targetChain === SUPPORTED_CHAINS.BASE) {
      estimatedTime = 10; // Base is faster
    } else if (config.targetChain === SUPPORTED_CHAINS.ETHEREUM) {
      estimatedTime = 20; // Ethereum can be slower
    }

    return {
      gasLimit,
      gasPrice: gasPrice.gasPrice?.toString() || '20000000000',
      totalCost,
      estimatedTime
    };
  }

  /**
   * Initiate a bridge transaction
   */
  async initiateBridge(config: BridgeConfig): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer required for bridge transactions');
    }

    const bridgeAddress = BRIDGE_CONTRACTS[config.sourceChain]?.[config.targetChain];
    if (!bridgeAddress) {
      throw new Error(`Bridge not supported between chains ${config.sourceChain} and ${config.targetChain}`);
    }

    // Simplified bridge contract ABI
    const bridgeABI = [
      'function bridgeToken(address token, uint256 amount, address recipient, uint32 targetChain) external payable',
      'function bridgeETH(address recipient, uint32 targetChain) external payable'
    ];

    const bridgeContract = new ethers.Contract(bridgeAddress, bridgeABI, this.signer);

    let tx;
    if (config.tokenAddress === ethers.ZeroAddress) {
      // Bridge ETH
      tx = await bridgeContract.bridgeETH(config.recipient, config.targetChain, {
        value: config.amount
      });
    } else {
      // Bridge ERC20 token
      tx = await bridgeContract.bridgeToken(
        config.tokenAddress,
        config.amount,
        config.recipient,
        config.targetChain
      );
    }

    return tx.hash;
  }

  /**
   * Check the status of a bridge transaction
   */
  async getBridgeStatus(transactionHash: string, sourceChain: number): Promise<BridgeStatus> {
    try {
      const receipt = await this.provider.getTransactionReceipt(transactionHash);
      
      if (!receipt) {
        return {
          transactionHash,
          status: 'pending',
          sourceChain,
          targetChain: 0,
          amount: '0',
          timestamp: Date.now()
        };
      }

      // Parse bridge event logs to get details
      const status: BridgeStatus = {
        transactionHash,
        status: receipt.status === 1 ? 'confirmed' : 'failed',
        sourceChain,
        targetChain: 0, // Would parse from logs
        amount: '0', // Would parse from logs
        timestamp: Date.now()
      };

      return status;
    } catch (error) {
      return {
        transactionHash,
        status: 'failed',
        sourceChain,
        targetChain: 0,
        amount: '0',
        timestamp: Date.now()
      };
    }
  }

  /**
   * Get optimal bridge route for a token transfer
   */
  async getOptimalRoute(
    fromChain: number,
    toChain: number,
    tokenSymbol: string,
    amount: string
  ): Promise<{
    route: number[];
    estimatedTime: number;
    estimatedCost: string;
    slippage: number;
  }> {
    // Direct route if supported
    if (BRIDGE_CONTRACTS[fromChain]?.[toChain]) {
      const gasEstimate = await this.estimateGas({
        sourceChain: fromChain,
        targetChain: toChain,
        bridgeContract: BRIDGE_CONTRACTS[fromChain][toChain],
        tokenAddress: TOKEN_ADDRESSES[tokenSymbol as keyof typeof TOKEN_ADDRESSES]?.[fromChain] || ethers.ZeroAddress,
        amount,
        recipient: ethers.ZeroAddress
      });

      return {
        route: [fromChain, toChain],
        estimatedTime: gasEstimate.estimatedTime,
        estimatedCost: gasEstimate.totalCost,
        slippage: 0.1 // 0.1% slippage for direct routes
      };
    }

    // Multi-hop route through Ethereum
    if (fromChain !== SUPPORTED_CHAINS.ETHEREUM && toChain !== SUPPORTED_CHAINS.ETHEREUM) {
      return {
        route: [fromChain, SUPPORTED_CHAINS.ETHEREUM, toChain],
        estimatedTime: 45, // Longer for multi-hop
        estimatedCost: '0.01', // Higher cost for multi-hop
        slippage: 0.3 // Higher slippage for multi-hop
      };
    }

    throw new Error(`No route found from chain ${fromChain} to ${toChain}`);
  }

  /**
   * Get bridge transaction history for an address
   */
  async getBridgeHistory(address: string, limit: number = 10): Promise<BridgeStatus[]> {
    // This would typically query bridge contract events
    // Simplified implementation returns empty array
    return [];
  }

  /**
   * Calculate bridge fees
   */
  calculateBridgeFees(amount: string, sourceChain: number, targetChain: number): {
    bridgeFee: string;
    gasFee: string;
    totalFee: string;
  } {
    const amountBN = BigInt(amount);
    
    // Bridge fee is typically 0.1% of amount
    const bridgeFee = (amountBN * BigInt(10)) / BigInt(10000); // 0.1%
    
    // Gas fee varies by chain
    let gasFee = BigInt('5000000000000000'); // 0.005 ETH default
    if (targetChain === SUPPORTED_CHAINS.BASE) {
      gasFee = BigInt('1000000000000000'); // 0.001 ETH for Base
    }

    const totalFee = bridgeFee + gasFee;

    return {
      bridgeFee: bridgeFee.toString(),
      gasFee: gasFee.toString(),
      totalFee: totalFee.toString()
    };
  }
}

// Utility functions
export function isChainSupported(chainId: number): boolean {
  return Object.values(SUPPORTED_CHAINS).includes(chainId as any);
}

export function getChainName(chainId: number): string {
  const chainNames = {
    [SUPPORTED_CHAINS.ETHEREUM]: 'Ethereum',
    [SUPPORTED_CHAINS.BASE]: 'Base',
    [SUPPORTED_CHAINS.OPTIMISM]: 'Optimism',
    [SUPPORTED_CHAINS.ARBITRUM]: 'Arbitrum',
    [SUPPORTED_CHAINS.POLYGON]: 'Polygon'
  };
  return chainNames[chainId as keyof typeof chainNames] || 'Unknown';
}

export function formatBridgeAmount(amount: string, decimals: number = 18): string {
  return ethers.formatUnits(amount, decimals);
}

export function parseBridgeAmount(amount: string, decimals: number = 18): string {
  return ethers.parseUnits(amount, decimals).toString();
}

// Export default instance
export default BaseBridge;
