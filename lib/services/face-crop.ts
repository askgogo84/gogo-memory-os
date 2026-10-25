import OpenAI from 'openai'
import sharp from 'sharp'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

type FaceBox = {
  face_detected: boolean
  x: number
  y: number
  width: number
  height: number
}

function getTwilioAuthHeader() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN

  if (!sid || !token) {
    throw new Error('Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN')
  }

  return `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`
}

function contentTypeToExtension(contentType: string) {
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  return 'jpeg'
}

function bufferToDataUrl(buffer: Buffer, contentType: string) {
  return `data:${contentType};base64,${buffer.toString('base64')}`
}

function extractJson(text: string): FaceBox | null {
  try {
    return JSON.parse(text) as FaceBox
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0]) as FaceBox
    } catch {
      return null
    }
  }
}

async function downloadMediaBuffer(mediaUrl: string) {
  const response = await fetch(mediaUrl, {
    headers: {
      Authorization: getTwilioAuthHeader(),
    },
  })

  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status}`)
  }

  const contentType = response.headers.get('content-type') || 'image/jpeg'
  const arrayBuffer = await response.arrayBuffer()

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
  }
}

async function detectPrimaryFaceBox(imageDataUrl: string): Promise<FaceBox | null> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a precise face-crop detector. Return ONLY JSON. Detect the main human face in the image and return normalized coordinates on a 0-1000 scale for the main face. x and y are top-left. width and height are size. If no face is clearly visible, return face_detected=false and zeros.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text:
              'Find the PRIMARY face only and return JSON exactly in this shape: ' +
              '{"face_detected":true,"x":123,"y":120,"width":420,"height":520} ' +
              'All values must be integers from 0 to 1000.',
          },
          {
            type: 'image_url',
            image_url: {
              url: imageDataUrl,
              detail: 'high',
            },
          },
        ],
      },
    ],
  })

  const text = response.choices?.[0]?.message?.content?.trim() || ''
  return extractJson(text)
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

async function buildFallbackPortrait(buffer: Buffer) {
  const output = await sharp(buffer)
    .resize(640, 800, {
      fit: 'cover',
      position: sharp.strategy.attention,
    })
    .jpeg({ quality: 90 })
    .toBuffer()

  return bufferToDataUrl(output, 'image/jpeg')
}

export async function cropFacePortraitFromMediaUrl(mediaUrl: string) {
  const { buffer, contentType } = await downloadMediaBuffer(mediaUrl)
  const inputDataUrl = bufferToDataUrl(buffer, contentType)

  let faceBox: FaceBox | null = null

  try {
    faceBox = await detectPrimaryFaceBox(inputDataUrl)
  } catch (error: any) {
    console.error('[face-crop] face detection failed:', error?.message || error)
  }

  if (!faceBox || !faceBox.face_detected) {
    return buildFallbackPortrait(buffer)
  }

  const image = sharp(buffer)
  const metadata = await image.metadata()

  const imageWidth = metadata.width || 0
  const imageHeight = metadata.height || 0

  if (!imageWidth || !imageHeight) {
    return buildFallbackPortrait(buffer)
  }

  const faceX = Math.round((faceBox.x / 1000) * imageWidth)
  const faceY = Math.round((faceBox.y / 1000) * imageHeight)
  const faceW = Math.round((faceBox.width / 1000) * imageWidth)
  const faceH = Math.round((faceBox.height / 1000) * imageHeight)

  if (faceW <= 0 || faceH <= 0) {
    return buildFallbackPortrait(buffer)
  }

  // Add padding around the face and force a portrait crop
  const targetAspect = 4 / 5 // width / height
  const paddedFaceW = faceW * 1.75
  const paddedFaceH = faceH * 2.10

  let cropW = paddedFaceW
  let cropH = cropW / targetAspect

  if (cropH < paddedFaceH) {
    cropH = paddedFaceH
    cropW = cropH * targetAspect
  }

  const centerX = faceX + faceW / 2
  const centerY = faceY + faceH * 0.56

  let left = Math.round(centerX - cropW / 2)
  let top = Math.round(centerY - cropH * 0.42)

  cropW = Math.round(cropW)
  cropH = Math.round(cropH)

  left = clamp(left, 0, Math.max(0, imageWidth - cropW))
  top = clamp(top, 0, Math.max(0, imageHeight - cropH))

  const width = clamp(cropW, 1, imageWidth - left)
  const height = clamp(cropH, 1, imageHeight - top)

  const output = await sharp(buffer)
    .extract({
      left,
      top,
      width,
      height,
    })
    .resize(640, 800, {
      fit: 'cover',
      position: 'center',
    })
    .jpeg({ quality: 90 })
    .toBuffer()

  return bufferToDataUrl(output, 'image/jpeg')
}