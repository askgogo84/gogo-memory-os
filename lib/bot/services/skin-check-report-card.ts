export async function buildSkinReportCardSafeFallbackImageResponse(report: any) {
  const hydration = score(report, 'hydration', 70)
  const barrier = score(report, 'barrier_support', 65)
  const oiliness = short(score(report, 'oiliness', 'moderate'), 18)
  const texture = short(score(report, 'texture', 'smooth'), 18)
  const skinType = short(report.skin_type || 'Combination', 22)

  const observations = list(report.observations_json || [], 4, [
    'T-zone shine visible',
    'Mild under-eye darkness',
    'Even overall tone',
    'Skin barrier appears stable',
  ])

  const am = list(report.am_routine_json || [], 3, [
    'Gentle cleanser',
    'Lightweight moisturizer',
    'SPF 50 sunscreen',
  ])

  const pm = list(report.pm_routine_json || [], 3, [
    'Gentle cleanser',
    'Niacinamide serum',
    'Lightweight moisturizer',
  ])

  const cautions = list(report.cautions_json || [], 3, [
    'Avoid harsh exfoliation',
    'Avoid skipping sunscreen',
    'Avoid heavy pore-clogging creams',
  ])

  const dateLabel = report?.created_at
    ? new Date(report.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  const element = box(
    [
      box(null, {
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, #071d18 0%, #102620 52%, #050908 100%)',
      }),

      Txt({
        children: 'ASKGOGO SKIN CHECK',
        style: {
          position: 'absolute',
          top: 56,
          left: 60,
          color: '#e7d4b0',
          fontSize: 40,
          fontWeight: 800,
          letterSpacing: 2,
        },
      }),

      Txt({
        children: 'VISUAL SKIN ANALYSIS',
        style: {
          position: 'absolute',
          top: 105,
          left: 62,
          color: '#bfae8a',
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 4,
        },
      }),

      Txt({
        children: dateLabel,
        style: {
          position: 'absolute',
          top: 62,
          right: 64,
          color: '#d7c29a',
          fontSize: 20,
          fontWeight: 700,
        },
      }),

      box(
        [
          Txt({ children: 'AT A GLANCE', style: { color: '#173a31', fontSize: 24, fontWeight: 900 } }),
          Txt({ children: `Skin Type: ${skinType}`, style: { marginTop: 18, color: '#173a31', fontSize: 20, fontWeight: 700 } }),
          Txt({ children: `Hydration: ${scorePercent(hydration, 70)} / 100`, style: { marginTop: 10, color: '#173a31', fontSize: 20, fontWeight: 700 } }),
          Txt({ children: `Barrier Support: ${scorePercent(barrier, 65)} / 100`, style: { marginTop: 10, color: '#173a31', fontSize: 20, fontWeight: 700 } }),
          Txt({ children: `Oiliness: ${oiliness}`, style: { marginTop: 10, color: '#173a31', fontSize: 20, fontWeight: 700 } }),
          Txt({ children: `Texture: ${texture}`, style: { marginTop: 10, color: '#173a31', fontSize: 20, fontWeight: 700 } }),
        ],
        {
          position: 'absolute',
          top: 170,
          left: 60,
          width: 450,
          height: 320,
          borderRadius: 28,
          background: '#f2e4c7',
          padding: 30,
          display: 'flex',
          flexDirection: 'column',
        }
      ),

      box(
        [
          Txt({ children: 'KEY OBSERVATIONS', style: { color: '#173a31', fontSize: 24, fontWeight: 900 } }),
          ...observations.map((item) =>
            Txt({
              children: `• ${item}`,
              style: {
                marginTop: 16,
                color: '#173a31',
                fontSize: 20,
                fontWeight: 700,
                lineHeight: 1.25,
              },
            })
          ),
        ],
        {
          position: 'absolute',
          top: 170,
          right: 60,
          width: 510,
          height: 320,
          borderRadius: 28,
          background: '#f2e4c7',
          padding: 30,
          display: 'flex',
          flexDirection: 'column',
        }
      ),

      box(
        [
          Txt({ children: 'AM ROUTINE', style: { color: '#173a31', fontSize: 24, fontWeight: 900 } }),
          ...am.map((item, i) =>
            Txt({
              children: `${i + 1}. ${item}`,
              style: {
                marginTop: 16,
                color: '#173a31',
                fontSize: 20,
                fontWeight: 700,
              },
            })
          ),
        ],
        {
          position: 'absolute',
          top: 540,
          left: 60,
          width: 450,
          height: 280,
          borderRadius: 28,
          background: '#f2e4c7',
          padding: 30,
          display: 'flex',
          flexDirection: 'column',
        }
      ),

      box(
        [
          Txt({ children: 'PM ROUTINE', style: { color: '#173a31', fontSize: 24, fontWeight: 900 } }),
          ...pm.map((item, i) =>
            Txt({
              children: `${i + 1}. ${item}`,
              style: {
                marginTop: 16,
                color: '#173a31',
                fontSize: 20,
                fontWeight: 700,
              },
            })
          ),
        ],
        {
          position: 'absolute',
          top: 540,
          right: 60,
          width: 510,
          height: 280,
          borderRadius: 28,
          background: '#f2e4c7',
          padding: 30,
          display: 'flex',
          flexDirection: 'column',
        }
      ),

      box(
        [
          Txt({ children: 'AVOID THIS WEEK', style: { color: '#173a31', fontSize: 24, fontWeight: 900 } }),
          ...cautions.map((item) =>
            Txt({
              children: `• ${item}`,
              style: {
                marginTop: 16,
                color: '#173a31',
                fontSize: 20,
                fontWeight: 700,
              },
            })
          ),
        ],
        {
          position: 'absolute',
          top: 870,
          left: 60,
          right: 60,
          height: 210,
          borderRadius: 28,
          background: '#f2e4c7',
          padding: 30,
          display: 'flex',
          flexDirection: 'column',
        }
      ),

      Txt({
        children:
          'Not medical advice. For painful acne, infection, irritation, rashes, or changing moles, consult a dermatologist.',
        style: {
          position: 'absolute',
          left: 60,
          right: 60,
          bottom: 60,
          color: '#c7b28d',
          fontSize: 16,
          fontWeight: 600,
          textAlign: 'center',
        },
      }),
    ],
    {
      display: 'flex',
      position: 'relative',
      width: '100%',
      height: '100%',
      fontFamily: 'Arial, sans-serif',
      overflow: 'hidden',
    }
  )

  return new ImageResponse(element, {
    width: 1080,
    height: 1350,
  })
}