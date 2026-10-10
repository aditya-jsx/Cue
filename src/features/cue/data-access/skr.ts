import {
  type Address,
  address,
  type Base58EncodedBytes,
  createSolanaRpc,
  getAddressDecoder,
  getAddressEncoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  getUtf8Decoder,
  getUtf8Encoder,
} from '@solana/kit'

// .skr names are AllDomains (ANS) accounts on mainnet, whatever cluster the rest of the app uses. Resolving one is a
// PDA derivation plus an account read. Layout and seeds: .claude/skills/seeker-domains/references/kit-resolver.md

type Rpc = ReturnType<typeof createSolanaRpc>

// ponytail: the public endpoint, fine for one lookup per send plus the user's own name; move behind the parser server
// (key kept server-side, shared cache) if traffic grows.
export const mainnetRpc = createSolanaRpc('https://api.mainnet-beta.solana.com')

const ANS_PROGRAM = address('ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK')
const TLD_HOUSE_PROGRAM = address('TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S')
const NAME_HOUSE_PROGRAM = address('NH3uX6FtVE2fNREAioP7hm5RaozotZxeL6khU1EHx51')
export const ROOT_ANS = address('3mX9b4AZaQehNoQGfckVcmgmA6bkBoFcbLj9RMmMyNcU')
const TLD = '.skr'
const HEADER_SIZE = 200
const OWNER_OFFSET = 40
const EXPIRES_AT_OFFSET = 104

const utf8 = (value: string) => new Uint8Array(getUtf8Encoder().encode(value))
const addressBytes = (value: Address) => new Uint8Array(getAddressEncoder().encode(value))
const ZERO_32 = new Uint8Array(32)
const base64 = getBase64Encoder()

// SHA-256 from WebCrypto: react-native-quick-crypto installs it in the app (polyfill.js), Node has it natively.
const hashName = async (name: string) =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', utf8('ALT Name Service' + name)))

async function pda(programAddress: Address, seeds: Uint8Array[]) {
  const [derived] = await getProgramDerivedAddress({ programAddress, seeds })
  return derived
}

export const deriveNameAccount = async (name: string, parent?: Address) =>
  pda(ANS_PROGRAM, [await hashName(name), ZERO_32, parent ? addressBytes(parent) : ZERO_32])
const deriveTldHouse = () => pda(TLD_HOUSE_PROGRAM, [utf8('tld_house'), utf8(TLD)])
const deriveReverseAccount = async (nameAccount: Address, tldHouse: Address) =>
  pda(ANS_PROGRAM, [await hashName(nameAccount), addressBytes(tldHouse), ZERO_32])

async function accountData(rpc: Rpc, account: Address) {
  const { value } = await rpc.getAccountInfo(account, { commitment: 'confirmed', encoding: 'base64' }).send()
  return value ? new Uint8Array(base64.encode(value.data[0])) : null
}

const expired = (expiresAtSeconds: bigint) => expiresAtSeconds !== 0n && Number(expiresAtSeconds) * 1000 < Date.now()

/**
 * What was said or typed as a .skr name, as a bare label: "alice.skr", "Alice dot SKR", "alice dot s k r". Null when
 * it isn't one, so contacts and addresses keep working as before.
 */
export function skrLabel(spoken: string): string | null {
  const m = spoken
    .trim()
    .toLowerCase()
    .match(/^(.+?)\s*(?:\.|\s+dot\s+)\s*s\s*k\s*r\.?$/)
  const label = m?.[1].replace(/\s+/g, '')
  return label && /^[a-z0-9-]{1,63}$/.test(label) ? label : null
}

/** Forward lookup: the wallet that owns `label`.skr, or null when it isn't registered (or has expired). */
export async function resolveSkr(rpc: Rpc, label: string): Promise<Address | null> {
  const nameAccount = await deriveNameAccount(label, await deriveNameAccount(TLD, ROOT_ANS))
  const data = await accountData(rpc, nameAccount)
  if (!data || data.length < HEADER_SIZE) return null
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (expired(view.getBigUint64(EXPIRES_AT_OFFSET, true))) return null
  const owner = getAddressDecoder().decode(data.subarray(OWNER_OFFSET, OWNER_OFFSET + 32))

  // ponytail: a domain minted as an NFT records an nft_record PDA as owner. No .skr name is tokenized today, so refuse
  // it rather than guess who holds the NFT; follow the holder (kit-resolver.md) if that changes.
  const nameHouse = await pda(NAME_HOUSE_PROGRAM, [utf8('name_house'), addressBytes(await deriveTldHouse())])
  const nftRecord = await pda(NAME_HOUSE_PROGRAM, [
    utf8('nft_record'),
    addressBytes(nameHouse),
    addressBytes(nameAccount),
  ])
  return owner === nftRecord ? null : owner
}

/** Reverse lookup: the .skr names `owner` holds, sorted so the first one is stable. Needs getProgramAccounts. */
export async function skrNamesOf(rpc: Rpc, owner: Address): Promise<string[]> {
  const parent = await deriveNameAccount(TLD, ROOT_ANS)
  const tldHouse = await deriveTldHouse()
  const accounts = await rpc
    .getProgramAccounts(ANS_PROGRAM, {
      dataSlice: { length: 8, offset: EXPIRES_AT_OFFSET },
      encoding: 'base64',
      filters: [
        { memcmp: { bytes: parent as string as Base58EncodedBytes, encoding: 'base58', offset: 8n } },
        { memcmp: { bytes: owner as string as Base58EncodedBytes, encoding: 'base58', offset: BigInt(OWNER_OFFSET) } },
      ],
    })
    .send()
  const live = accounts.filter(({ account }) => {
    const bytes = new Uint8Array(base64.encode(account.data[0]))
    return bytes.length === 8 && !expired(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true))
  })
  // Only the user's own wallet is ever looked up, so its few names fit one request.
  const reverse = await Promise.all(live.slice(0, 100).map(({ pubkey }) => deriveReverseAccount(pubkey, tldHouse)))
  if (!reverse.length) return []
  const { value } = await rpc.getMultipleAccounts(reverse, { encoding: 'base64' }).send()
  const names = value.flatMap((entry) => {
    const data = entry ? new Uint8Array(base64.encode(entry.data[0])) : null
    const label =
      data && data.length > HEADER_SIZE ? getUtf8Decoder().decode(data.subarray(HEADER_SIZE)).replace(/\0.*$/, '') : ''
    return label ? [label + TLD] : []
  })
  return names.sort()
}
