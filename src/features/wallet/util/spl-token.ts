import {
  AccountRole,
  type Address,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Instruction,
} from '@solana/kit'

export const TOKEN_PROGRAM_ADDRESS = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
export const ATA_PROGRAM_ADDRESS = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')
export const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111')
export const NATIVE_MINT_ADDRESS = address('So11111111111111111111111111111111111111112')

export async function findAtaAddress(
  ownerAddress: Address,
  mintAddress: Address = NATIVE_MINT_ADDRESS,
): Promise<Address> {
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

export function getCreateAssociatedTokenAccountIdempotentInstruction({
  associatedToken,
  mint,
  owner,
  payer,
}: {
  associatedToken: Address
  mint: Address
  owner: Address
  payer: Address
}): Instruction {
  return {
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: associatedToken, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: new Uint8Array([1]), // CreateIdempotent instruction index = 1
    programAddress: ATA_PROGRAM_ADDRESS,
  }
}

export function getSyncNativeInstruction({ account }: { account: Address }): Instruction {
  return {
    accounts: [{ address: account, role: AccountRole.WRITABLE }],
    data: new Uint8Array([17]), // SyncNative instruction index = 17
    programAddress: TOKEN_PROGRAM_ADDRESS,
  }
}

export function getApproveInstruction({
  amount,
  delegate,
  owner,
  source,
}: {
  amount: bigint | number
  delegate: Address
  owner: Address
  source: Address
}): Instruction {
  const data = new Uint8Array(9)
  const view = new DataView(data.buffer)
  view.setUint8(0, 4) // Approve instruction index = 4
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

export function getRevokeInstruction({ owner, source }: { owner: Address; source: Address }): Instruction {
  return {
    accounts: [
      { address: source, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY_SIGNER },
    ],
    data: new Uint8Array([5]), // Revoke instruction index = 5
    programAddress: TOKEN_PROGRAM_ADDRESS,
  }
}

export function getTransferTokenInstruction({
  amount,
  authority,
  destination,
  source,
}: {
  amount: bigint | number
  authority: Address
  destination: Address
  source: Address
}): Instruction {
  const data = new Uint8Array(9)
  const view = new DataView(data.buffer)
  view.setUint8(0, 3) // Transfer instruction index = 3
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
