import { AccountRole, type Address, address, type Instruction, type Lamports } from '@solana/kit'

export const SYSTEM_PROGRAM_ADDRESS = address('11111111111111111111111111111111')

export interface GetTransferSolInstructionParams {
  amount: Lamports | bigint | number
  destination: Address
  source: Address
}

export function getTransferSolInstruction({
  amount,
  destination,
  source,
}: GetTransferSolInstructionParams): Instruction {
  const data = new Uint8Array(12)
  const view = new DataView(data.buffer)

  // SystemInstruction::Transfer index = 2 (u32 little-endian)
  view.setUint32(0, 2, true)
  // Lamports amount (u64 little-endian)
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
