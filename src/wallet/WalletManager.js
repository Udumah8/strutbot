import { Keypair, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { setTimeout as delay } from 'timers/promises';
import { ComputeBudgetProgram, SystemProgram } from '@solana/web3.js';
import BN from 'bn.js';
import {
  MIN_SOL_BUFFER_LAMPORTS_BN,
  PRIORITY_FEE_MICRO_LAMPORTS,
  MAX_COOLDOWN_AGE_MS,
  PERSONALITIES,
  WALLET_CLEANUP_CHANCE,
} from '../constants.js';
import { getRandomNumberBetween } from '../utils.js';
import { WalletDataLoader } from './WalletDataLoader.js';

/**
 * Wallet Management System
 * Handles wallet generation, loading, funding, and rotation
 */
export class WalletManager {
  /**
   * @param {ConfigManager} config
   * @param {Connection} connection
   * @param {Logger} logger
   */
  constructor(config, connection, logger) {
    this.config = config;
    this.connection = connection;
    this.logger = logger;
    this.walletDataLoader = new WalletDataLoader(config, logger);
    this.walletData = [];
    this.allPubkeys = new Set();
    this.funded = new Set();
    this.activeWallets = [];
    this.walletCooldowns = new Map();
    this.walletTradeCount = new Map();
    this.walletPersonalities = new Map();
    this.masterKeypair = null;
    this.sinkKeypair = null;
    this.relayerKeypairs = [];
    // [FIXED] Add funding locks to prevent race conditions
    this.fundingLocks = new Set();
  }

  /**
   * Loads or generates wallets based on configuration
   */
  async loadOrGenerateWallets() {
    try {
      this.walletData = await this.walletDataLoader.loadWallets();
      this.normalizeWalletData();
      this.allPubkeys = new Set(this.walletData.map(w => w.pubkey));
      this.logger.info(`Loaded ${this.walletData.length.toLocaleString()} existing wallets`);

      if (this.walletData.length < this.config.numWalletsToGenerate) {
        await this.generateWallets();
      }

      this.loadSpecialWallets();

      if (this.config.autoScale) {
        this.adjustConcurrency();
      }

      await this.fundWalletsInParallel();
    } catch (error) {
      this.logger.error('Failed to load or generate wallets', { error: error.message });
      throw error;
    }
  }

  /**
   * Normalizes wallet data structure
   */
  normalizeWalletData() {
    this.walletData = this.walletData.map(w => ({
      pubkey: w.pubkey || w.publicKey || Keypair.fromSecretKey(new Uint8Array(w.privateKey)).publicKey.toBase58(),
      privateKey: w.privateKey,
      name: w.name || `Wallet`,
      isSeasoned: w.isSeasoned || false,
    }));
  }

  /**
   * Generates additional wallets to meet the required count
   */
  async generateWallets() {
    const remaining = this.config.numWalletsToGenerate - this.walletData.length;
    this.logger.info(`Generating ${remaining.toLocaleString()} wallets...`);

    const batchSize = 1000;
    for (let i = 0; i < remaining; i += batchSize) {
      const size = Math.min(batchSize, remaining - i);
      const batch = Array.from({ length: size }, () => {
        const kp = Keypair.generate();
        return {
          pubkey: kp.publicKey.toBase58(),
          privateKey: Array.from(kp.secretKey),
          name: `Wallet${this.walletData.length + i + 1}`,
          isSeasoned: false,
        };
      });

      batch.forEach(wallet => this.allPubkeys.add(wallet.pubkey));
      this.walletData.push(...batch);
      this.logger.info(`${this.walletData.length.toLocaleString()}/${this.config.numWalletsToGenerate.toLocaleString()}`);
      await delay(10);
    }

    await this.walletDataLoader.writeWallets(this.walletData);
  }

  /**
   * Loads sink and relayer wallets
   */
  loadSpecialWallets() {
    if (this.config.masterPrivateKey) {
      this.masterKeypair = Keypair.fromSecretKey(new Uint8Array(this.config.masterPrivateKey));
      this.logger.info('Master wallet loaded');
    } else {
      this.logger.warn('No MASTER_PRIVATE_KEY found in .env. Relayer funding will not be possible.');
    }

    if (this.config.sinkPrivateKey) {
      this.sinkKeypair = Keypair.fromSecretKey(new Uint8Array(this.config.sinkPrivateKey));
      this.logger.info('Sink wallet loaded');
    } else {
      this.logger.warn('No SINK_PRIVATE_KEY found in .env. Withdrawals will not be possible.');
    }

    if (this.config.relayerPrivateKeys?.length > 0) {
      this.relayerKeypairs = this.config.relayerPrivateKeys.map(pk => Keypair.fromSecretKey(new Uint8Array(pk)));
      this.logger.info(`Loaded ${this.relayerKeypairs.length} relayer wallets`);
    } else {
      this.logger.warn('No RELAYER_PRIVATE_KEYS found in .env. Relayer functionality will be limited.');
    }
  }

  /**
   * Adjusts concurrency based on the number of wallets
   */
  adjustConcurrency() {
    this.config.concurrency = Math.min(50, Math.max(3, Math.floor(this.walletData.length / 200) + 3));
    this.config.batchSize = Math.min(20, Math.max(2, Math.floor(this.walletData.length / 300) + 2));
  }

  /**
   * Funds wallets in parallel using relayer wallets
   */
  async fundWalletsInParallel() {
    if (this.relayerKeypairs.length === 0) {
      this.logger.info('No relayer wallets configured, skipping funding');
      return;
    }

    // First, ensure relayer wallets have sufficient balance
    await this.fundRelayerWallets();

    this.logger.info(`Checking funding for ${this.walletData.length} wallets...`);
    const toCheck = this.walletData.filter(w => !this.funded.has(w.pubkey));

    const fundBatchSize = 50;
    for (let i = 0; i < toCheck.length; i += fundBatchSize) {
      const batch = toCheck.slice(i, i + fundBatchSize);
      const promises = batch.map(wallet => this.fundSingleWallet(wallet));
      await Promise.allSettled(promises);
      this.logger.info(`Funding progress: ${Math.min(i + fundBatchSize, toCheck.length)}/${toCheck.length}`);
    }
  }

  /**
   * Funds relayer wallets from master wallet if needed
   */
  async fundRelayerWallets() {
    if (!this.masterKeypair) {
      this.logger.warn('No master wallet available, cannot fund relayers');
      return;
    }

    if (this.relayerKeypairs.length === 0) {
      this.logger.info('No relayer wallets to fund');
      return;
    }

    this.logger.info('Checking relayer wallet balances...');

    // Check current balance of master wallet
    const masterBalance = await this.connection.getBalance(this.masterKeypair.publicKey);
    const masterBalanceSol = (masterBalance / LAMPORTS_PER_SOL).toFixed(6);

    this.logger.info(`Master wallet balance: ${masterBalanceSol} SOL`);

    if (masterBalance < 50000000) { // Less than 0.05 SOL
      this.logger.warn('Master wallet has insufficient balance for relayer funding');
      return;
    }

    // Check each relayer wallet
    const minRelayerBalance = 25000000; // 0.025 SOL minimum per relayer
    const targetRelayerBalance = 50000000; // 0.05 SOL target per relayer

    for (const relayer of this.relayerKeypairs) {
      try {
        const currentBalance = await this.connection.getBalance(relayer.publicKey);
        
        if (currentBalance < minRelayerBalance) {
          const fundingNeeded = targetRelayerBalance - currentBalance;
          
          // Ensure master has enough balance
          const availableBalance = masterBalance - 10000000; // Keep 0.01 SOL buffer
          
          if (availableBalance >= fundingNeeded) {
            try {
              const tx = new Transaction()
                .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 25000 }))
                .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }))
                .add(SystemProgram.transfer({
                  fromPubkey: this.masterKeypair.publicKey,
                  toPubkey: relayer.publicKey,
                  lamports: fundingNeeded,
                }));

              const sig = await this.connection.sendTransaction(tx, [this.masterKeypair], { skipPreflight: true });
              
              // Wait for confirmation
              await this.connection.confirmTransaction(sig, 'confirmed');
              
              this.logger.info(`Funded relayer wallet`, {
                from: this.masterKeypair.publicKey.toBase58().slice(0, 8),
                to: relayer.publicKey.toBase58().slice(0, 8),
                amount: (fundingNeeded / LAMPORTS_PER_SOL).toFixed(6),
                signature: sig.slice(0, 16) + '...'
              });

              // Add delay between transfers
              await delay(2000);
              
            } catch (txError) {
              this.logger.error('Failed to fund relayer wallet', {
                relayer: relayer.publicKey.toBase58().slice(0, 8),
                error: txError.message
              });
            }
          } else {
            this.logger.warn('Insufficient master wallet balance for relayer funding', {
              available: (availableBalance / LAMPORTS_PER_SOL).toFixed(6),
              needed: (fundingNeeded / LAMPORTS_PER_SOL).toFixed(6)
            });
          }
        } else {
          this.logger.debug(`Relayer wallet ${relayer.publicKey.toBase58().slice(0, 8)} has sufficient balance: ${(currentBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
        }
      } catch (balanceError) {
        this.logger.error('Failed to check relayer wallet balance', {
          relayer: relayer.publicKey.toBase58().slice(0, 8),
          error: balanceError.message
        });
      }
    }
  }

  /**
   * Verifies if a transaction succeeded by checking status and balance
   * @param {string} signature - Transaction signature
   * @param {PublicKey} recipient - Expected recipient address
   * @param {BN} expectedIncrease - Expected balance increase
   * @param {BN} priorBalance - Balance before transaction
   * @returns {Promise<'success'|'failed'|'unknown'>}
   */
  async verifyTransaction(signature, recipient, expectedIncrease, priorBalance) {
    try {
      // Check transaction status
      const statusResponse = await this.connection.getSignatureStatus(signature);

      if (statusResponse?.value?.confirmationStatus === 'confirmed' ||
        statusResponse?.value?.confirmationStatus === 'finalized') {
        // Transaction confirmed, check if it succeeded
        if (statusResponse.value.err === null) {
          return 'success';
        } else {
          return 'failed';
        }
      }

      // If status unclear, verify by balance change
      try {
        const currentBalance = await this.connection.getBalance(recipient);
        const currentBalanceBN = new BN(currentBalance.toString());
        const increase = currentBalanceBN.sub(priorBalance);

        // If balance increased by approximately the expected amount (within 1%), consider it success
        const lowerBound = expectedIncrease.mul(new BN('99')).div(new BN('100'));
        const upperBound = expectedIncrease.mul(new BN('101')).div(new BN('100'));

        if (increase.gte(lowerBound) && increase.lte(upperBound)) {
          return 'success';
        }
      } catch (balanceError) {
        this.logger.debug('Could not verify by balance', { error: balanceError.message });
      }

      return 'unknown';
    } catch (error) {
      this.logger.debug('Transaction verification failed', { error: error.message });
      return 'unknown';
    }
  }

  /**
   * Funds a single wallet with enhanced retry logic and verification
   * @param {Object} wallet
   */
  async fundSingleWallet(wallet) {
    // [FIXED] Atomic check-and-set to prevent race conditions
    const lockKey = `funding_${wallet.pubkey}`;

    // Check if already funded or being funded
    if (this.funded.has(wallet.pubkey) || this.fundingLocks.has(lockKey)) {
      return;
    }

    this.fundingLocks.add(lockKey);

    try {
      const kp = Keypair.fromSecretKey(new Uint8Array(wallet.privateKey));

      // Get balance - handle both regular and BigInt return types
      const balance = await this.connection.getBalance(kp.publicKey);
      const balanceBN = new BN(balance.toString());

      // [FIXED] Config.fundAmount is already BN in lamports from ConfigManager
      const fundAmountLamports = new BN(this.config.fundAmount.toString());
      const threshold = fundAmountLamports.mul(new BN('8')).div(new BN('10'));

      if (balanceBN.gte(threshold)) {
        // Already funded, mark as funded
        this.funded.add(wallet.pubkey);
        return;
      }

      let remaining = fundAmountLamports.sub(balanceBN);
      const parts = Math.floor(Math.random() * 4) + 1;
      const maxRetries = 2; // Maximum retry attempts per transaction

      for (let p = 0; p < parts && remaining.gt(MIN_SOL_BUFFER_LAMPORTS_BN); p++) {
        const cappedPart = this.calculateFundingPart(remaining, parts - p);
        const relayer = this.relayerKeypairs[Math.floor(Math.random() * this.relayerKeypairs.length)];
        let txSuccess = false;

        // Retry loop with exponential backoff
        for (let retry = 0; retry <= maxRetries && !txSuccess; retry++) {
          try {
            const tx = new Transaction()
              .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 25000 }))
              .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_FEE_MICRO_LAMPORTS }))
              .add(SystemProgram.transfer({
                fromPubkey: relayer.publicKey,
                toPubkey: kp.publicKey,
                lamports: BigInt(cappedPart.toString()),
              }));

            const priorBalance = balanceBN.add(fundAmountLamports).sub(remaining);
            const sig = await this.connection.sendTransaction(tx, [relayer], { skipPreflight: true });

            // Log transaction sent
            this.logger.debug(`Transaction sent for ${wallet.name}`, {
              signature: sig.slice(0, 16) + '...',
              attempt: retry + 1
            });

            try {
              await this.connection.confirmTransaction(sig, 'confirmed');
              txSuccess = true;
              this.logger.info(`Funded ${wallet.name}: ${(cappedPart.toNumber() / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
            } catch (confirmError) {
              // Confirmation timed out, verify if transaction actually succeeded
              if (confirmError.message.includes('not confirmed')) {
                this.logger.info(`Confirmation timeout for ${wallet.name}, verifying transaction...`, {
                  signature: sig,
                  explorer: `https://solscan.io/tx/${sig}`
                });

                const verified = await this.verifyTransaction(sig, kp.publicKey, cappedPart, priorBalance);

                if (verified === 'success') {
                  txSuccess = true;
                  this.logger.info(`Transaction verified successful for ${wallet.name}`, {
                    amount: (cappedPart.toNumber() / LAMPORTS_PER_SOL).toFixed(4),
                    signature: sig.slice(0, 16) + '...'
                  });
                } else if (verified === 'failed') {
                  this.logger.warn(`Transaction failed verification, will retry`, {
                    wallet: wallet.name,
                    attempt: retry + 1
                  });
                  // Will retry if attempts remaining
                } else {
                  // Unknown status - be conservative and retry
                  this.logger.warn(`Transaction status unknown, assuming failed`, {
                    wallet: wallet.name,
                    signature: sig,
                    attempt: retry + 1
                  });
                }
              } else {
                // Other error, rethrow
                throw confirmError;
              }
            }

            // If successful, update remaining and add delay
            if (txSuccess) {
              remaining = remaining.sub(cappedPart);
              await delay(1000 + Math.random() * 2000);
            } else if (retry < maxRetries) {
              // Exponential backoff before retry
              const backoffMs = Math.pow(2, retry) * 1000;
              this.logger.debug(`Retry backoff for ${wallet.name}`, { delayMs: backoffMs });
              await delay(backoffMs);
            }
          } catch (txError) {
            // Log error and decide whether to retry
            if (retry < maxRetries) {
              this.logger.warn(`Transaction error for ${wallet.name}, retrying...`, {
                error: txError.message.slice(0, 100),
                attempt: retry + 1,
                maxAttempts: maxRetries + 1
              });
              await delay(Math.pow(2, retry) * 1000); // Exponential backoff
            } else {
              this.logger.warn(`Transaction failed for ${wallet.name} after ${maxRetries + 1} attempts`, {
                error: txError.message.slice(0, 100),
                remainingParts: parts - p - 1
              });
            }
          }
        }

        // Continue to next part even if this one failed (other parts might succeed)
      }

      // Mark as funded after attempting all parts
      this.funded.add(wallet.pubkey);
    } catch (error) {
      this.logger.warn(`Failed to fund ${wallet.name}`, { error: error.message });
      // Don't mark as funded on catastrophic failure
    } finally {
      // Always clean up the lock
      this.fundingLocks.delete(lockKey);
    }
  }

  /**
   * Calculates the amount for a single funding transaction
   * @param {BN} remaining
   * @param {number} remainingParts
   * @returns {BN}
   */
  calculateFundingPart(remaining, remainingParts) {
    const factor = Math.floor((0.6 + Math.random() * 0.8) * 1000);
    const basePart = remaining.mul(new BN(factor)).div(new BN(1000)).div(new BN(remainingParts.toString()));
    const partNum = BN.max(basePart, MIN_SOL_BUFFER_LAMPORTS_BN);
    return BN.min(partNum, remaining);
  }

  /**
   * Loads the next batch of active wallets for trading
   */
  async loadActiveBatch() {
    const now = Date.now();
    this.cleanupOldCooldowns(now);

    // Check if seasoning is required
    const requireSeasoning = this.config.enableSeasoning;

    const ready = this.walletData.filter(w => {
      // Check cooldown status
      const lastTrade = this.walletCooldowns.get(w.pubkey) || 0;
      const cooldown = this.getWalletCooldown(w.pubkey);
      const cooldownPassed = now - lastTrade >= cooldown;

      // Check seasoning status if required
      const isSeasoned = !requireSeasoning || w.isSeasoned === true;

      return cooldownPassed && isSeasoned;
    });

    if (ready.length === 0) {
      if (requireSeasoning) {
        const unseasonedCount = this.walletData.filter(w => !w.isSeasoned).length;
        this.logger.info('No wallets ready for trading - all unseasoned wallets need seasoning', {
          totalWallets: this.walletData.length,
          unseasonedWallets: unseasonedCount,
          seasonedWallets: this.walletData.length - unseasonedCount
        });
      } else {
        this.logger.debug('No wallets ready for a new batch.');
      }
      return [];
    }

    const shuffled = this.config.shuffleWallets ? this.shuffleArray(ready) : ready;
    const selected = shuffled.slice(0, this.config.batchSize);

    this.activeWallets = selected.map(w => ({
      keypair: Keypair.fromSecretKey(new Uint8Array(w.privateKey)),
      name: w.name || w.pubkey.slice(0, 6),
      pubkey: w.pubkey,
    }));

    this.logger.info(`Loaded batch: ${this.activeWallets.length} wallets (Pool: ${ready.length}/${this.walletData.length})`, {
      requireSeasoning,
      seasonedWallets: ready.filter(w => w.isSeasoned).length,
      unseasonedEligible: ready.filter(w => !w.isSeasoned).length
    });
    return this.activeWallets;
  }

  /**
   * Cleans up old cooldown entries to prevent memory leaks
   * @param {number} now
   */
  cleanupOldCooldowns(now) {
    // [FIXED] Enhanced cleanup with better memory management
    const cleanupThreshold = MAX_COOLDOWN_AGE_MS;
    const entriesToDelete = [];

    for (const [key, timestamp] of this.walletCooldowns.entries()) {
      if (now - timestamp > cleanupThreshold) {
        entriesToDelete.push(key);
      }
    }

    // Delete in batch to avoid concurrent modification issues
    for (const key of entriesToDelete) {
      this.walletCooldowns.delete(key);
    }

    // Clean up trade counts periodically (only 1% of the time to avoid performance impact)
    if (Math.random() < WALLET_CLEANUP_CHANCE) {
      let cleanedCount = 0;
      for (const [key, count] of this.walletTradeCount.entries()) {
        if (count > 1000) {
          this.walletTradeCount.set(key, 1000);
          cleanedCount++;
        }
      }

      // Log cleanup activity if significant cleanup occurred
      if (cleanedCount > 10) {
        this.logger.debug('Cleaned up trade counts', {
          cleanedWallets: cleanedCount,
          totalWallets: this.walletTradeCount.size
        });
      }
    }

    // Additional memory management: periodically clean up wallets that are no longer active
    if (Math.random() < 0.001) { // Very rare cleanup (0.1%)
      const inactiveThreshold = 7 * 24 * 60 * 60 * 1000; // 7 days
      const inactiveWallets = [];

      for (const [key, timestamp] of this.walletCooldowns.entries()) {
        if (now - timestamp > inactiveThreshold) {
          inactiveWallets.push(key);
        }
      }

      // Only clean up if we have many inactive wallets to avoid removing active ones
      if (inactiveWallets.length > 100) {
        for (const key of inactiveWallets) {
          this.walletCooldowns.delete(key);
          this.walletTradeCount.delete(key);
        }

        this.logger.info('Deep cleanup of inactive wallets', {
          removedWallets: inactiveWallets.length,
          remainingActive: this.walletCooldowns.size
        });
      }
    }
  }

  /**
   * Shuffles an array using Fisher-Yates algorithm
   * @param {Array} array
   * @returns {Array}
   */
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      // Use Math.random() directly for proper integer generation
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Gets the cooldown period for a wallet
   * @param {string} walletKey
   * @returns {number}
   */
  getWalletCooldown(walletKey) {
    const tradeCount = this.walletTradeCount.get(walletKey) || 0;
    const cooldownMultiplier = 1 + (tradeCount % 5) * 0.2;
    const baseCooldown = getRandomNumberBetween(this.config.minWalletCooldownMs, this.config.maxWalletCooldownMs);
    return Math.floor(baseCooldown * cooldownMultiplier);
  }

  /**
   * Marks a wallet as used after trading
   * @param {Object} wallet
   */
  markWalletUsed(wallet) {
    const walletKey = wallet.keypair.publicKey.toBase58();
    this.walletCooldowns.set(walletKey, Date.now());
    this.walletTradeCount.set(walletKey, (this.walletTradeCount.get(walletKey) || 0) + 1);
  }

  /**
   * Assigns personalities to wallets for varied behavior
   */
  assignPersonalities() {
    this.allPubkeys.forEach(pubkey => {
      this.walletPersonalities.set(pubkey, PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)]);
    });
  }

  /**
   * Gets the personality of a wallet
   * @param {string|PublicKey} pubkey
   * @returns {string}
   */
  getPersonality(pubkey) {
    const key = typeof pubkey === 'string' ? pubkey : pubkey.toBase58();
    return this.walletPersonalities.get(key) || 'flipper';
  }
}