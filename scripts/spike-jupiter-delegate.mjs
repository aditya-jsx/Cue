// Spike: can a delegate (Cue session key) be the transfer authority of a Jupiter swap?
// Read-only: mainnet quote + simulateTransaction with sigVerify off. Nothing is signed or sent.
// Run: node scripts/spike-jupiter-delegate.mjs   (MAINNET_RPC / JUP_BASE optional)
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createClient,
  createTransactionMessage,
  fetchAddressesForLookupTables,
  generateKeyPairSigner,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'
import { solanaRpcConnection } from '@solana/kit-plugin-rpc'

const RPC = process.env.MAINNET_RPC || 'https://api.mainnet-beta.solana.com'
const JUP = process.env.JUP_BASE || 'https://lite-api.jup.ag/swap/v1'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const JUP_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const ATA_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')

const client = createClient().use(solanaRpcConnection({ rpcUrl: RPC }))

async function ata(owner, mint) {
  const enc = getAddressEncoder()
  const [pda] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [enc.encode(owner), enc.encode(TOKEN_PROGRAM), enc.encode(mint)],
  })
  return pda
}

// A real wallet holding USDC in its canonical ATA (Jupiter derives the source ATA from userPublicKey).
// (getTokenLargestAccounts is blocked on public RPCs, so try known exchange wallets; HOLDER=<addr> overrides.)
const HOLDERS = [
  process.env.HOLDER,
  '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9',
  'H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS',
  'FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5',
  'AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2',
].filter(Boolean)

async function findUsdcHolder() {
  for (const h of HOLDERS) {
    const owner = address(h)
    const tokenAcc = await ata(owner, address(USDC))
    try {
      const { value } = await client.rpc.getTokenAccountBalance(tokenAcc).send()
      if (Number(value.uiAmount) >= 10) return { owner, ata: tokenAcc }
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('no candidate holds >=10 USDC in its canonical ATA; pass HOLDER=<address>')
}

// Jupiter instruction -> kit instruction. If `rewrite`, the signer slot held by `owner` is handed to `delegate`.
const toIx = (ix, owner, delegate, rewrite) => ({
  programAddress: address(ix.programId),
  accounts: ix.accounts.map((a) => {
    const isOwnerSigner = rewrite && a.isSigner && a.pubkey === owner
    const pubkey = isOwnerSigner ? delegate : a.pubkey
    return { address: address(pubkey), role: (a.isSigner ? 2 : 0) | (a.isWritable ? 1 : 0) }
  }),
  data: new Uint8Array(Buffer.from(ix.data, 'base64')),
})

const holder = await findUsdcHolder()
// Fee payer = the holder (funded), only so the simulation gets past the fee-payer check. Real Cue: the session key pays.
const FEE_PAYER = holder.owner
const delegate = (await generateKeyPairSigner()).address
console.log('owner (USDC holder):', holder.owner)
console.log('owner USDC ATA     :', holder.ata)
console.log('delegate (session) :', delegate)

const q = await fetch(`${JUP}/quote?inputMint=${USDC}&outputMint=${JUP_MINT}&amount=1000000&slippageBps=50`).then((r) => r.json())
const swap = await fetch(`${JUP}/swap-instructions`, {
  body: JSON.stringify({ payer: FEE_PAYER, quoteResponse: q, userPublicKey: holder.owner }),
  headers: { 'content-type': 'application/json' },
  method: 'POST',
}).then((r) => r.json())
if (!swap.swapInstruction) throw new Error('swap-instructions failed: ' + JSON.stringify(swap).slice(0, 300))

const ixs = [
  ...swap.computeBudgetInstructions,
  ...swap.setupInstructions,
  swap.swapInstruction,
  ...(swap.cleanupInstruction ? [swap.cleanupInstruction] : []),
  ...(swap.otherInstructions ?? []),
]
const signerSlots = swap.swapInstruction.accounts.filter((a) => a.isSigner).map((a) => a.pubkey)
console.log('signers in route ix before rewrite:', signerSlots)

const { value: bh } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
let msg = pipe(
  createTransactionMessage({ version: 0 }),
  (m) => setTransactionMessageFeePayer(FEE_PAYER, m),
  (m) => setTransactionMessageLifetimeUsingBlockhash(bh, m),
  (m) => appendTransactionMessageInstructions(ixs.map((i) => toIx(i, holder.owner, delegate, i === swap.swapInstruction)), m),
)
const alts = await fetchAddressesForLookupTables(swap.addressLookupTableAddresses.map(address), client.rpc)
msg = compressTransactionMessageUsingAddressLookupTables(msg, alts)

const wire = getBase64EncodedWireTransaction(compileTransaction(msg))
const { value: sim } = await client.rpc
  .simulateTransaction(wire, { commitment: 'confirmed', encoding: 'base64', replaceRecentBlockhash: true, sigVerify: false })
  .send()

const logs = sim.logs ?? []
console.log('\nsimulation err:', JSON.stringify(sim.err, (_, v) => (typeof v === 'bigint' ? String(v) : v)))
console.log(logs.slice(-12).join('\n'))

const ownerMismatch = logs.some((l) => /owner does not match/i.test(l))
console.log(
  '\nVERDICT:',
  sim.err === null
    ? 'PASS (swap simulated cleanly?! delegate was accepted)'
    : ownerMismatch
      ? 'STRUCTURE OK: route reached the token authority check and rejected only because the delegate is not approved on-chain (expected).'
      : 'INCONCLUSIVE/FAIL: error is not the expected OwnerMismatch, read logs above.',
)
