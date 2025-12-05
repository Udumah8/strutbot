# Solana Volume Booster Bot

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Solana](https://img.shields.io/badge/Solana-Compatible-blue.svg)](https://solana.com/)

A sophisticated, production-ready Solana trading bot designed for volume generation with advanced stealth features, multiple trading strategies, and comprehensive safety mechanisms.

## 🚀 Key Features

### 🔥 Core Trading Capabilities
- **Multi-Market Support**: Pump Fun, Raydium (AMM/CLMM/CPMM), Orca, Meteora, and more
- **Advanced Trading Modes**: Adaptive, buy-only, sell-only, random, and sentiment-based
- **TWAP (Time-Weighted Average Price)**: Large trade splitting for better execution
- **Sentiment Analysis**: Integrated market sentiment data for smarter decisions
- **Partial Sell Strategy**: Intelligent profit-taking with configurable ranges

### 🔒 Stealth & Safety Features
- **Burner Wallet Churning (BWC)**: Automatic wallet lifecycle management
- **Circuit Breakers**: Multiple safety stops for risk management
- **Wallet Seasoning**: Realistic trading behavior simulation
- **MEV Protection**: Jito integration for private transactions
- **Smart Rebalancing**: Automated SOL distribution across wallets

### 🧠 AI-Powered Strategies
- **Behavioral Profiles**: Retail, whale, and mixed trading patterns
- **Personality-Based Trading**: Flipper, hodler, and momentum strategies
- **Adaptive Amount Scaling**: Dynamic trade sizing based on market conditions
- **Volatility-Based Adjustments**: Smart position sizing

### 📊 Monitoring & Analytics
- **Real-Time Market Data**: Birdeye API integration for live metrics
- **Comprehensive Logging**: Winston-based structured logging
- **Alert System**: Critical event notifications
- **Performance Metrics**: Volume tracking and success rates

## 🏗️ Architecture Overview

```
VolumeBoosterBot (Main Orchestrator)
├── ConfigManager (Environment & Validation)
├── WalletManager (Regular Wallet Lifecycle)
├── BurnerWalletManager (Burner Wallet Management)
├── TradingEngine (Core Trading Logic)
├── MarketDataProvider (Market Intelligence)
├── CircuitBreaker (Safety Systems)
├── WalletRebalancer (SOL Distribution)
├── WalletSeasoner (Behavior Simulation)
├── Logger (Structured Logging)
└── AlertManager (Notifications)
```

### Component Details

| Component | Purpose | Key Features |
|-----------|---------|--------------|
| **VolumeBoosterBot** | Main orchestrator | Coordinate all systems, handle shutdown |
| **ConfigManager** | Configuration management | Environment validation, type safety |
| **WalletManager** | Wallet lifecycle | Generation, funding, rotation |
| **TradingEngine** | Trading execution | Multi-mode strategies, TWAP |
| **MarketDataProvider** | Market intelligence | Price, liquidity, sentiment data |
| **CircuitBreaker** | Risk management | Failure tracking, automatic stops |

## 📦 Installation

### Prerequisites
- Node.js >= 18.0.0
- npm or yarn
- Solana wallet with SOL for mainnet testing
- Premium RPC endpoint (recommended)

### Quick Start

1. **Clone the repository**
```bash
git clone https://github.com/your-username/solana-volume-bot.git
cd solana-volume-bot
```

2. **Install dependencies**
```bash
npm install
```

3. **Configure environment**
```bash
cp .env.example .env
# Edit .env with your configuration
```

4. **Start the bot**
```bash
npm start
```

## ⚙️ Configuration

### Required Settings

```env
# Network Configuration
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
MEME_COIN_MINT=your_token_mint_address
MARKET=RAYDIUM_AMM

# Trading Parameters
SWAP_AMOUNT=0.01
TRADE_MODE=adaptive
BUY_PROB=0.5

# Wallet Management
MAX_WALLETS=all
FUND_AMOUNT=0.02
```

### Advanced Configuration

#### Trading Strategies
```env
# Trade Modes
TRADE_MODE=adaptive          # adaptive, buy_only, sell_only, random
NUM_ACTIONS_PER_CYCLE=2      # Actions per wallet per cycle
TWAP_PARTS=5                 # Split large trades
TWAP_MAX_DELAY=10000         # Delay between TWAP parts (ms)

# Behavior Profiles
BEHAVIOR_PROFILE=retail      # retail, whale, mixed
```

#### Safety & Risk Management
```env
# Circuit Breakers
ENABLE_CIRCUIT_BREAKER=true
MAX_CONSECUTIVE_FAILURES=10
MAX_FAILURE_RATE_PCT=50
EMERGENCY_STOP_LOSS_PCT=30

# Rebalancing
ENABLE_REBALANCING=true
TARGET_WALLET_BALANCE_SOL=0.05
REBALANCE_INTERVAL_CYCLES=50
```

#### Stealth Features
```env
# Burner Wallet Churning (BWC)
BWC_ENABLED=true
BWC_MODE=hybrid             # disabled, hybrid, burner_only
BWC_BURNER_RATIO=0.3        # % of burner wallets in hybrid mode
BWC_MAX_BURNER_WALLETS=50
BWC_BURNER_LIFETIME_TXS=5

# Wallet Seasoning
ENABLE_SEASONING=true
SEASONING_MIN_TXS=3
SEASONING_MAX_TXS=10
```

#### MEV Protection
```env
# Jito Configuration
ENABLE_JITO=true
JITO_PRIORITY_FEE_SOL=0.002
JITO_TIP_SOL_BUY=0.0012
JITO_TIP_SOL_SELL=0.0018
```

## 🎯 Usage Examples

### Basic Setup
```javascript
import { VolumeBoosterBot } from './src/VolumeBoosterBot.js';

const bot = new VolumeBoosterBot();
await bot.init();
```

### Custom Configuration
```javascript
import { ConfigManager } from './src/config/ConfigManager.js';

const config = new ConfigManager();
// All environment variables are automatically validated
```

### Trading Modes

1. **Adaptive Mode** (Default)
```env
TRADE_MODE=adaptive
BUY_PROB=0.5
```
- Smart decision making based on market conditions
- Sentiment analysis integration
- Behavioral profile adjustments

2. **Aggressive Mode**
```env
TRADE_MODE=buy_only
NUM_ACTIONS_PER_CYCLE=3
BEHAVIOR_PROFILE=whale
```
- Continuous buying strategy
- Higher trade volumes
- Whale-like behavior

3. **Conservative Mode**
```env
TRADE_MODE=random
BUY_PROB=0.3
TWAP_PARTS=10
```
- Risk-averse approach
- TWAP for large trades
- Lower buy probability

### Keyboard Controls

When `ENABLE_KEYBOARD_TRIGGERS=true`:

- **`q`** or **`Ctrl+C`**: Graceful shutdown
- **`w`**: Manual withdrawal of all funds

## 🛡️ Safety Features

### Circuit Breaker System
The bot includes multiple layers of protection:

1. **Consecutive Failure Limit**
   - Stops after N consecutive failed trades
   - Configurable via `MAX_CONSECUTIVE_FAILURES`

2. **Failure Rate Monitoring**
   - Tracks failure rate in sliding window
   - Stops if rate exceeds threshold
   - Configurable via `MAX_FAILURE_RATE_PCT`

3. **Emergency Stop Loss**
   - Monitors master wallet balance
   - Stops if losses exceed percentage
   - Configurable via `EMERGENCY_STOP_LOSS_PCT`

### Wallet Management Safety
- **Automatic Fund Recovery**: Withdraws all funds on shutdown
- **Balance Validation**: Checks minimum balances before trading
- **Error Handling**: Comprehensive try-catch with fallbacks
- **Clean Shutdown**: Graceful termination with resource cleanup

## 📈 Performance Optimization

### RPC Optimization
```env
# Use premium RPC for better performance
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY

# Adjust concurrency based on RPC capacity
CONCURRENCY=50              # High-performance RPC
AUTO_SCALE_CONCURRENCY=true # Automatic scaling
```

### Market Data Integration
```env
# Real-time market data
BIRDEYE_API_KEY=your_api_key
MIN_LIQUIDITY_USD=5000      # Filter low-liquidity pools
MAX_PRICE_IMPACT_PCT=5      # Avoid high-impact trades
```

### Batch Processing
```env
BATCH_SIZE=100              # Wallets per batch
CONCURRENCY=50              # Parallel operations
SESSION_PAUSE_MIN=10        # Periodic pauses
```

## 🔧 API Reference

### Core Classes

#### VolumeBoosterBot
```javascript
class VolumeBoosterBot {
  constructor()
  async init()              // Initialize all systems
  async stop()              // Graceful shutdown
  async withdrawAllFunds()  // Emergency fund recovery
}
```

#### ConfigManager
```javascript
class ConfigManager {
  constructor()
  validate(key, validator, defaultValue)  // Validate env vars
  getEnvVarDocumentation(key)             // Get variable docs
}
```

#### TradingEngine
```javascript
class TradingEngine {
  constructor(config, connection, marketData, walletManager, logger)
  async processWalletCycle(wallet, circuitBreaker)
  getTradeActions(wallet)
  async performSwap(isBuy, wallet)
}
```

### Configuration Schema

| Variable | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `RPC_URL` | string | ✅ | - | Solana RPC endpoint |
| `MEME_COIN_MINT` | string | ✅ | - | Token mint address |
| `MARKET` | string | ✅ | RAYDIUM_AMM | Trading market |
| `SWAP_AMOUNT` | number | ✅ | 0.01 | Base swap amount (SOL) |
| `TRADE_MODE` | string | ❌ | adaptive | Trading strategy |
| `MAX_WALLETS` | number/string | ❌ | all | Wallet limit |

## 🧪 Testing

### Unit Tests
```bash
npm test
```

### Test Coverage
```bash
npm run test:coverage
```

### Integration Tests
```bash
# Test with devnet
RPC_URL=https://api.devnet.solana.com npm start
```

## 🚨 Troubleshooting

### Common Issues

#### Configuration Errors
```bash
# Invalid RPC URL
Error: Invalid RPC_URL: must be a valid HTTP/HTTPS URL

# Invalid mint address
Error: Invalid MEME_COIN_MINT: must be a valid Solana public key
```

#### Wallet Issues
```bash
# Insufficient SOL
Error: Insufficient SOL balance

# Wallet generation failed
Error: Failed to generate wallets - check FUND_AMOUNT
```

#### Network Issues
```bash
# RPC rate limits
Error: Rate limit exceeded - consider premium RPC

# Transaction failures
Error: Transaction failed - check network conditions
```

### Debug Mode
```bash
# Enable debug logging
DEBUG=true npm start

# Check wallet balances
curl -X POST http://localhost:3000/wallets/balance
```

### Log Analysis
```bash
# View recent logs
tail -f bot.log

# Search for errors
grep "ERROR" bot.log

# Check trading performance
grep "Batch.*complete" bot.log
```

## 📊 Monitoring & Metrics

### Key Metrics
- **Trading Volume**: Total SOL traded per cycle
- **Success Rate**: Percentage of successful trades
- **Wallet Utilization**: Active vs. cooldown wallets
- **Error Rate**: Failed transaction percentage
- **Circuit Breaker Status**: Safety system state

### Logging Levels
```javascript
// Available log levels
logger.info('Information messages')
logger.warn('Warning messages')
logger.error('Error messages')
logger.debug('Debug messages')
```

### Alert System
```env
# Enable alerts
ENABLE_ALERTING=true

# Alert types
- Bot initialization failures
- Circuit breaker triggers
- Critical trading errors
- Fund withdrawal completions
```

## 🤝 Contributing

### Development Setup
```bash
# Fork the repository
git clone https://github.com/your-username/solana-volume-bot.git

# Install dependencies
npm install

# Run in development mode
npm run dev
```

### Code Standards
- ESLint configuration for code style
- Jest for unit testing
- Comprehensive error handling
- Type safety with JSDoc comments

### Pull Request Process
1. Fork the repository
2. Create feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit pull request

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## ⚠️ Disclaimer

**Important**: This software is for educational and research purposes. Trading cryptocurrencies involves substantial risk of loss. Use at your own risk and ensure compliance with local regulations.

### Risk Warnings
- Cryptocurrency trading is highly volatile
- Past performance does not guarantee future results
- Always test on devnet before mainnet deployment
- Use proper risk management and position sizing

## 🔗 Links

- [Solana Documentation](https://docs.solana.com/)
- [Raydium SDK](https://station.raydium.io/)
- [Birdeye API](https://birdeye.so/)
- [Jito Documentation](https://jito.xyz/)

## 📞 Support

For questions and support:
- Create an issue on GitHub
- Check the troubleshooting section
- Review the configuration examples

---

**Happy Trading! 🚀📈**

*Built with ❤️ for the Solana ecosystem*