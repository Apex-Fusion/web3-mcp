# Vector MCP Server

MCP (Model Context Protocol) server for the **Vector blockchain** — Apex Fusion's L2. Enables AI agents (Claude, GPT, Gemini, or any MCP client) to interact with Vector natively: query balances, send ADA, transfer tokens, and manage spending safely.

Built on [Ogmios](https://ogmios.dev/) + [Koios](https://www.koios.rest/) — no Blockfrost dependency.

## Features

- **Wallet management** — derive addresses from mnemonic, query balances and UTxOs
- **ADA transfers** — build, sign, and submit transactions via submit-api
- **Native token transfers** — send any Vector native asset
- **Safety controls** — per-transaction and daily spend limits with audit logging
- **Ogmios-native** — direct chain access, no third-party indexer lock-in

## MCP Tools

| Tool | Description |
|------|-------------|
| `vector_get_balance` | Get ADA and token balances for any Vector address |
| `vector_get_address` | Get the agent's wallet address and balance |
| `vector_get_utxos` | List UTxOs for an address or the agent's wallet |
| `vector_send_ada` | Send ADA (respects spend limits) |
| `vector_send_tokens` | Send native tokens |
| `vector_get_spend_limits` | Check spend limits and remaining budget |

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your mnemonic and endpoint URLs
```

### 3. Build

```bash
npm run build
```

### 4. Add to Claude Desktop

Add to your Claude Desktop MCP config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "vector": {
      "command": "node",
      "args": ["/path/to/vector-mcp-server/build/index.js"],
      "env": {
        "VECTOR_MNEMONIC": "your mnemonic words here",
        "VECTOR_OGMIOS_URL": "https://ogmios.vector.testnet.apexfusion.org",
        "VECTOR_SUBMIT_URL": "https://submit.vector.testnet.apexfusion.org/api/submit/tx",
        "VECTOR_KOIOS_URL": "https://koios.vector.testnet.apexfusion.org/",
        "VECTOR_EXPLORER_URL": "https://vector.testnet.apexscan.org"
      }
    }
  }
}
```

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `VECTOR_OGMIOS_URL` | Ogmios HTTP JSON-RPC endpoint | `https://ogmios.vector.testnet.apexfusion.org` |
| `VECTOR_KOIOS_URL` | Koios REST API endpoint | `https://koios.vector.testnet.apexfusion.org/` |
| `VECTOR_SUBMIT_URL` | Transaction submit API | `https://submit.vector.testnet.apexfusion.org/api/submit/tx` |
| `VECTOR_EXPLORER_URL` | Block explorer base URL | `https://vector.testnet.apexscan.org` |
| `VECTOR_MNEMONIC` | 15 or 24-word BIP39 mnemonic | *(required)* |
| `VECTOR_ACCOUNT_INDEX` | HD wallet account index | `0` |
| `VECTOR_SPEND_LIMIT_PER_TX` | Max lovelace per transaction | `100000000` (100 ADA) |
| `VECTOR_SPEND_LIMIT_DAILY` | Max lovelace per day | `500000000` (500 ADA) |

## Architecture

```
┌──────────────────────┐      ┌──────────────────────────┐
│  Claude / GPT / etc. │◄────►│  vector-mcp-server       │
│  (any MCP client)    │ MCP  │                          │
└──────────────────────┘      │  ┌────────────────────┐  │
                              │  │ Safety Layer        │  │
                              │  │ - Per-tx limits     │  │
                              │  │ - Daily limits      │  │
                              │  │ - Audit log         │  │
                              │  └────────┬───────────┘  │
                              │           │               │
                              │  ┌────────▼───────────┐  │
                              │  │ Lucid + Ogmios     │  │
                              │  │ Provider            │  │
                              │  └────────┬───────────┘  │
                              │           │               │
                              │  ┌────────▼───────────┐  │
                              │  │ Ogmios / Koios /   │  │
                              │  │ Submit API          │  │
                              │  └────────────────────┘  │
                              └──────────────────────────┘
```

## About Vector

Vector is Apex Fusion's UTXO-based L2 blockchain, running with Cardano's mainnet parameters. It provides near-instant finality and 4x Cardano throughput, making it ideal for AI agent interactions.

- **Explorer:** https://vector.testnet.apexscan.org
- **Apex Fusion:** https://apexfusion.org
