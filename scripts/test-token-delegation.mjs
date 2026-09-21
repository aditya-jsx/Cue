import {
  AccountRole,
  addSignersToTransactionMessage,
  address,
  appendTransactionMessageInstruction,
  createClient,
  createKeyPairSignerFromPrivateKeyBytes,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase58Decoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from '@solana/kit'
import { solanaRpcConnection } from '@solana/kit-plugin-rpc'
import { Buffer } from 'buffer'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

// Program IDs
const TOKEN_PROGRAM_ADDRESS = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ATA_PROGRAM_ADDRESS = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111')
const NATIVE_MINT_ADDRESS = address('So11111111111111111111111111111111111111112')

// Client connection to Devnet
const DEVNET_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
const client = createClient().use(solanaRpcConnection({ rpcUrl: DEVNET_RPC_URL }))

console.log('='.repeat(70))
console.log('  SOLANA SPL TOKEN DELEGATION (SESSION KEYS) TEST SUITE')
console.log('  Cluster:', DEVNET_RPC_URL)
console.log('='.repeat(70))

// -----------------------------------------------------------------------------
// Helper: Instruction Builders
// -----------------------------------------------------------------------------

function getCreateAssociatedTokenAccountIdempotentInstruction({ associatedToken, mint, owner, payer }) {
  return {
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: associatedToken, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]), // CreateIdempotent index = 1
    programAddress: ATA_PROGRAM_ADDRESS,
  }
}

function getTransferSolInstruction({ amount, destination, source }) {
  const data = new Uint8Array(12)
  const view = new DataView(data.buffer)
  view.setUint32(0, 2, true) // System Transfer = 2
  view.setBigUint64(4, BigInt(amount), true)
  return {
    accounts: [
      { address: source, role: AccountRole.WRITABLE_SIGNER },
      { address: destination, role: AccountRole.WRITABLE },
    ],
    data,
    programAddress: SYSTEM_PROGRAM_ADDRESS,
  }
}

function getSyncNativeInstruction({ account }) {
  return {
    accounts: [{ address: account, role: AccountRole.WRITABLE }],
    data: new Uint8Array([17]), // SyncNative index = 17
    programAddress: TOKEN_PROGRAM_ADDRESS,
  }
}

function getApproveInstruction({ amount, delegate, owner, source }) {
  const data = new Uint8Array(9)
  const view = new DataView(data.buffer)
  view.setUint8(0, 4) // Approve index = 4
  view.setBigUint64(1, BigInt(amount), true)
  return {
    accounts: [
      { address: source, role: AccountRole.WRITABLE },
      { address: delegate, role: AccountRole.READONLY },
      { address: owner, role: AccountRole.READONLY_SIGNER },
    ],
    data,
    programAddress: TOKEN_PROGRAM_ADDRESS,
  }
}

function getRevokeInstruction({ owner, source }) {
  return {
    accounts: [
      { address: source, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY_SIGNER },
    ],
    data: new Uint8Array([5]), // Revoke index = 5
    programAddress: TOKEN_PROGRAM_ADDRESS,
  }
}

function getTransferTokenInstruction({ amount, authority, destination, source }) {
  const data = new Uint8Array(9)
  const view = new DataView(data.buffer)
  view.setUint8(0, 3) // Transfer index = 3
  view.setBigUint64(1, BigInt(amount), true)
  return {
    accounts: [
      { address: source, role: AccountRole.WRITABLE },
      { address: destination, role: AccountRole.WRITABLE },
      { address: authority, role: AccountRole.READONLY_SIGNER },
    ],
    data,
    programAddress: TOKEN_PROGRAM_ADDRESS,
  }
}

// -----------------------------------------------------------------------------
// Helper: PDA Derivation & Token Account Parsing
// -----------------------------------------------------------------------------

async function findAtaAddress(ownerAddress, mintAddress = NATIVE_MINT_ADDRESS) {
  const [ata] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM_ADDRESS,
    seeds: [
      getAddressEncoder().encode(ownerAddress),
      getAddressEncoder().encode(TOKEN_PROGRAM_ADDRESS),
      getAddressEncoder().encode(mintAddress),
    ],
  })
  return ata
}

function parseTokenAccount(rawBytes) {
  const view = new DataView(rawBytes.buffer, rawBytes.byteOffset, rawBytes.byteLength)
  const mint = getBase58Decoder().decode(rawBytes.slice(0, 32))
  const owner = getBase58Decoder().decode(rawBytes.slice(32, 64))
  const amount = view.getBigUint64(64, true)
  const delegateOption = view.getUint32(72, true)
  const delegate = delegateOption === 1 ? getBase58Decoder().decode(rawBytes.slice(76, 108)) : null
  const delegatedAmount = delegateOption === 1 ? view.getBigUint64(121, true) : 0n
  return { amount, delegate, delegatedAmount, mint, owner }
}

async function queryTokenAccount(tokenAddress) {
  const res = await client.rpc.getAccountInfo(tokenAddress, { encoding: 'base64' }).send()
  if (!res.value) {
    return null
  }
  const [base64Data] = res.value.data
  const rawBytes = Buffer.from(base64Data, 'base64')
  return parseTokenAccount(rawBytes)
}

// -----------------------------------------------------------------------------
// Helper: Transaction Sender & Confirmer
// -----------------------------------------------------------------------------

async function sendAndConfirm({ feePayer, instructions, signers }) {
  const { value: latestBlockhash } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()

  let message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
  )

  for (const ix of instructions) {
    message = appendTransactionMessageInstruction(ix, message)
  }

  if (signers && signers.length > 0) {
    message = addSignersToTransactionMessage(signers, message)
  }

  const signedTransaction = await signTransactionMessageWithSigners(message)
  const base64WireTx = getBase64EncodedWireTransaction(signedTransaction)

  const signature = await client.rpc
    .sendTransaction(base64WireTx, {
      encoding: 'base64',
      preflightCommitment: 'confirmed',
    })
    .send()

  // Poll confirmation
  for (let i = 0; i < 30; i++) {
    try {
      const {
        value: [status],
      } = await client.rpc.getSignatureStatuses([signature]).send()
      if (status?.err) {
        throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`)
      }
      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        return signature
      }
    } catch (e) {
      if (String(e).includes('failed on-chain')) throw e
    }
    await new Promise((r) => setTimeout(r, 1500))
  }

  return signature
}

// -----------------------------------------------------------------------------
// Main Test Routine
// -----------------------------------------------------------------------------

async function run() {
  // 1. Prepare Keypairs
  console.log('\n[1/7] Preparing Keypairs...')
  const keyDir = path.join(process.cwd(), 'scripts')
  const ownerKeyPath = path.join(keyDir, '.test-owner-key.json')

  let owner
  if (fs.existsSync(ownerKeyPath)) {
    const raw = JSON.parse(fs.readFileSync(ownerKeyPath, 'utf8'))
    owner = await createKeyPairSignerFromPrivateKeyBytes(new Uint8Array(raw).slice(0, 32))
    console.log(`  Loaded existing Owner keypair: ${owner.address}`)
  } else {
    const rawBytes = crypto.randomBytes(32)
    fs.writeFileSync(ownerKeyPath, JSON.stringify(Array.from(rawBytes)))
    owner = await createKeyPairSignerFromPrivateKeyBytes(rawBytes)
    console.log(`  Generated new Owner keypair: ${owner.address}`)
  }

  // Generate Delegate (Session Key) & Recipient
  const delegate = await generateKeyPairSigner()
  const recipient = await generateKeyPairSigner()
  console.log(`  Delegate (Session Key): ${delegate.address}`)
  console.log(`  Recipient:             ${recipient.address}`)

  // Check Owner Balance
  const { value: initialBalance } = await client.rpc.getBalance(owner.address).send()
  console.log(`  Owner SOL balance:     ${Number(initialBalance) / 1e9} SOL`)

  if (initialBalance < 150_000_000n) {
    console.log('\n  Requesting 1 SOL airdrop from Devnet faucet...')
    try {
      const airdropSig = await client.rpc.requestAirdrop(owner.address, 1_000_000_000n).send()
      console.log(`  Airdrop requested. Signature: ${airdropSig}`)
      // wait 5s for airdrop
      await new Promise((r) => setTimeout(r, 5000))
    } catch (e) {
      console.warn('  Airdrop request failed (faucet may be rate-limited):', e.message)
      if (initialBalance < 20_000_000n) {
        console.error('\n  ERROR: Owner has insufficient SOL on Devnet to run test.')
        console.error(`  Please send 0.2 SOL from your wallet to: ${owner.address}`)
        process.exit(1)
      }
    }
  }

  // 2. Derive & Create Token Accounts
  console.log('\n[2/7] Creating and Funding Wrapped SOL (WSOL) Account...')
  const ownerAta = await findAtaAddress(owner.address)
  const recipientAta = await findAtaAddress(recipient.address)
  console.log(`  Owner WSOL ATA:     ${ownerAta}`)
  console.log(`  Recipient WSOL ATA: ${recipientAta}`)

  // Create owner ATA, recipient ATA, wrap 0.1 SOL into WSOL
  const wrapAmount = 100_000_000n // 0.1 WSOL
  const setupSig = await sendAndConfirm({
    feePayer: owner,
    instructions: [
      getCreateAssociatedTokenAccountIdempotentInstruction({
        associatedToken: ownerAta,
        mint: NATIVE_MINT_ADDRESS,
        owner: owner.address,
        payer: owner.address,
      }),
      getCreateAssociatedTokenAccountIdempotentInstruction({
        associatedToken: recipientAta,
        mint: NATIVE_MINT_ADDRESS,
        owner: recipient.address,
        payer: owner.address,
      }),
      getTransferSolInstruction({
        amount: wrapAmount,
        destination: ownerAta,
        source: owner.address,
      }),
      getSyncNativeInstruction({ account: ownerAta }),
    ],
    signers: [owner],
  })
  console.log(`  WSOL Account created and funded with 0.1 WSOL!`)
  console.log(`  Tx: https://explorer.solana.com/tx/${setupSig}?cluster=devnet`)

  let ownerState = await queryTokenAccount(ownerAta)
  console.log(`  Owner ATA balance: ${Number(ownerState.amount) / 1e9} WSOL`)

  // 3. Test approve()
  console.log('\n[3/7] Testing approve(): Delegating 0.05 WSOL allowance to Delegate...')
  const approveAmount = 50_000_000n // 0.05 WSOL cap
  const approveSig = await sendAndConfirm({
    feePayer: owner,
    instructions: [
      getApproveInstruction({
        amount: approveAmount,
        delegate: delegate.address,
        owner: owner.address,
        source: ownerAta,
      }),
    ],
    signers: [owner],
  })
  console.log(`  approve() transaction confirmed!`)
  console.log(`  Tx: https://explorer.solana.com/tx/${approveSig}?cluster=devnet`)

  ownerState = await queryTokenAccount(ownerAta)
  console.log(`  On-chain state verification:`)
  console.log(`    - Delegate:         ${ownerState.delegate}`)
  console.log(`    - Delegated Amount: ${Number(ownerState.delegatedAmount) / 1e9} WSOL (expected 0.05)`)

  if (ownerState.delegate !== delegate.address || ownerState.delegatedAmount !== approveAmount) {
    throw new Error('approve() verification failed!')
  }
  console.log('  PASS: Delegate and cap properly recorded on-chain.')

  // 4. Test spending as the delegate
  console.log('\n[4/7] Testing transfer as Delegate (WITHOUT owner signature)...')
  const spendAmount = 20_000_000n // 0.02 WSOL
  const spendSig = await sendAndConfirm({
    feePayer: owner, // Owner can pay tx network fee or delegate can; the authority is delegate!
    instructions: [
      getTransferTokenInstruction({
        amount: spendAmount,
        authority: delegate.address,
        destination: recipientAta,
        source: ownerAta,
      }),
    ],
    signers: [owner, delegate], // NOTE: delegate is the authority signing for the token transfer!
  })
  console.log(`  Delegate transfer of 0.02 WSOL succeeded!`)
  console.log(`  Tx: https://explorer.solana.com/tx/${spendSig}?cluster=devnet`)

  ownerState = await queryTokenAccount(ownerAta)
  const recipientState = await queryTokenAccount(recipientAta)
  console.log(`  On-chain state after transfer:`)
  console.log(`    - Owner Token Balance:     ${Number(ownerState.amount) / 1e9} WSOL (expected 0.08)`)
  console.log(`    - Remaining Delegate Cap:  ${Number(ownerState.delegatedAmount) / 1e9} WSOL (expected 0.03)`)
  console.log(`    - Recipient Token Balance: ${Number(recipientState.amount) / 1e9} WSOL (expected 0.02)`)

  if (ownerState.delegatedAmount !== 30_000_000n) {
    throw new Error('Delegated amount did not decrease properly!')
  }
  console.log('  PASS: Allowance automatically decremented on-chain.')

  // 5. Test the cap actually holds
  console.log('\n[5/7] Testing that the Cap actually holds...')
  console.log('  Attempting to spend 0.04 WSOL (remaining cap is only 0.03 WSOL)...')
  let overspendFailed = false
  try {
    await sendAndConfirm({
      feePayer: owner,
      instructions: [
        getTransferTokenInstruction({
          amount: 40_000_000n, // Exceeds remaining 0.03
          authority: delegate.address,
          destination: recipientAta,
          source: ownerAta,
        }),
      ],
      signers: [owner, delegate],
    })
  } catch (err) {
    overspendFailed = true
    console.log(`  Expected failure confirmed: ${err.message}`)
  }
  if (!overspendFailed) {
    throw new Error('FAILED: Delegate was able to spend more than the cap!')
  }
  console.log('  PASS: Overspending rejected by SPL Token Program.')

  console.log('  Now spending the exact remaining 0.03 WSOL...')
  await sendAndConfirm({
    feePayer: owner,
    instructions: [
      getTransferTokenInstruction({
        amount: 30_000_000n,
        authority: delegate.address,
        destination: recipientAta,
        source: ownerAta,
      }),
    ],
    signers: [owner, delegate],
  })
  ownerState = await queryTokenAccount(ownerAta)
  console.log(`  Remaining Delegate Cap: ${Number(ownerState.delegatedAmount) / 1e9} WSOL (expected 0.00)`)

  console.log('  Attempting one more transfer of 0.001 WSOL after cap exhausted...')
  let exhaustedSpendFailed = false
  try {
    await sendAndConfirm({
      feePayer: owner,
      instructions: [
        getTransferTokenInstruction({
          amount: 1_000_000n,
          authority: delegate.address,
          destination: recipientAta,
          source: ownerAta,
        }),
      ],
      signers: [owner, delegate],
    })
  } catch (err) {
    exhaustedSpendFailed = true
    console.log(`  Expected failure confirmed: ${err.message}`)
  }
  if (!exhaustedSpendFailed) {
    throw new Error('FAILED: Delegate was able to spend with exhausted cap!')
  }
  console.log('  PASS: Exhausted cap strictly enforced.')

  // 6. Test revoke()
  console.log('\n[6/7] Testing revoke()...')
  console.log('  First, owner approves a new 0.02 WSOL cap to delegate...')
  await sendAndConfirm({
    feePayer: owner,
    instructions: [
      getApproveInstruction({
        amount: 20_000_000n,
        delegate: delegate.address,
        owner: owner.address,
        source: ownerAta,
      }),
    ],
    signers: [owner],
  })
  ownerState = await queryTokenAccount(ownerAta)
  console.log(`  New Cap: ${Number(ownerState.delegatedAmount) / 1e9} WSOL, Delegate: ${ownerState.delegate}`)

  console.log('  Now calling revoke() from Owner wallet...')
  const revokeSig = await sendAndConfirm({
    feePayer: owner,
    instructions: [
      getRevokeInstruction({
        owner: owner.address,
        source: ownerAta,
      }),
    ],
    signers: [owner],
  })
  console.log(`  revoke() transaction confirmed!`)
  console.log(`  Tx: https://explorer.solana.com/tx/${revokeSig}?cluster=devnet`)

  ownerState = await queryTokenAccount(ownerAta)
  console.log(`  On-chain state after revoke:`)
  console.log(`    - Delegate:         ${ownerState.delegate ?? 'None'}`)
  console.log(`    - Delegated Amount: ${Number(ownerState.delegatedAmount) / 1e9} WSOL (expected 0)`)

  console.log('  Testing that delegate can no longer spend anything...')
  let revokedSpendFailed = false
  try {
    await sendAndConfirm({
      feePayer: owner,
      instructions: [
        getTransferTokenInstruction({
          amount: 5_000_000n,
          authority: delegate.address,
          destination: recipientAta,
          source: ownerAta,
        }),
      ],
      signers: [owner, delegate],
    })
  } catch (err) {
    revokedSpendFailed = true
    console.log(`  Expected failure confirmed: ${err.message}`)
  }
  if (!revokedSpendFailed) {
    throw new Error('FAILED: Delegate was able to spend after revoke!')
  }
  console.log('  PASS: Revocation successfully terminated all spending authority.')

  console.log('\n' + '='.repeat(70))
  console.log('  ALL 6 DELEGATION TESTS PASSED SUCCESSFULLY ON DEVNET!')
  console.log('='.repeat(70))
}

run().catch((err) => {
  console.error('\nFatal test runner error:', err)
  process.exit(1)
})
