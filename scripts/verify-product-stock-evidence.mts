import assert from 'node:assert/strict'
import { assessProductAvailabilityText } from '../lib/agent/watchers'

assert.equal(
  assessProductAvailabilityText('Size XL Sold out. Notify me when available.', 'XL'),
  'unavailable',
)
assert.equal(
  assessProductAvailabilityText('Size: XL Notify Me when available Color: Fossil Grey Available in classy colourways that make it a top choice', 'XL'),
  'unavailable',
  'generic marketing availability must not override selected-size stock state',
)
assert.equal(
  assessProductAvailabilityText('Color Fossil Grey. Size: XL. Add to cart. Inclusive of all taxes.', 'XL'),
  'available',
)
assert.equal(
  assessProductAvailabilityText('Size XL is available now. Add to bag.', 'XL'),
  'available',
)
assert.equal(
  assessProductAvailabilityText('Available in several colourways. Sizes XS S M L XL XXL.', 'XL'),
  'unknown',
  'bare marketing word available is not stock proof',
)
assert.equal(
  assessProductAvailabilityText('Size L Add to cart. Size XL Notify me when available.', 'XL'),
  'unavailable',
  'another variant add-to-cart must never mark XL available',
)
assert.equal(
  assessProductAvailabilityText('XL is in stock. XXL sold out.', 'XL'),
  'available',
  'neighboring variant sold-out evidence must not override XL in-stock evidence',
)
assert.equal(
  assessProductAvailabilityText('XXL is in stock. XL sold out.', 'XL'),
  'unavailable',
  'neighboring variant in-stock evidence must not override XL sold-out evidence',
)

console.log('product stock false-positive regression passed')
