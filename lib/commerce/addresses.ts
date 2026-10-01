export type CommerceAddress = {id: string; label: string; addressLine: string}

// Swiggy get_addresses schema. Do not return phone numbers or infer coordinates.
export function swiggyAddressPage(payload: unknown) {
  const data = payload as any
  if (!data || !Array.isArray(data.addresses) || typeof data.pagination?.hasMore !== 'boolean') throw new Error('commerce_address_response_invalid')
  const addresses: CommerceAddress[] = data.addresses.map((address: any) => {
    if (typeof address.id !== 'string' || !address.id || typeof address.addressLine !== 'string' || !address.addressLine) throw new Error('commerce_address_response_invalid')
    return {id: address.id, label: String(address.addressTag || address.addressCategory || 'Saved address'), addressLine: address.addressLine}
  })
  return {addresses, hasMore: data.pagination.hasMore}
}

export function chooseSavedAddress(addresses: CommerceAddress[], selection: string): CommerceAddress | null {
  const exact = addresses.filter(address => address.id === selection)
  if (exact.length === 1) return exact[0]
  const label = addresses.filter(address => address.label.trim().toLowerCase() === selection.trim().toLowerCase())
  return label.length === 1 ? label[0] : null
}
