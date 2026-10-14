// Light theme for the dashboard. The dark design writes colours straight into class names
// (bg-[#0b0b0b], text-[#f2efea]...). Rather than rewrite ~650 classes by hand, the light theme maps each
// dark colour to its light partner, only while the person has chosen light. The palette is the askgogo.in
// cream/ink/teal set. Colours not listed (cream discs, teal/amber/green fills with dark text, the old
// cream login page) look right on both and are left alone.
export const LIGHT_PALETTE = {
  bg: {
    '#0b0b0b': '#f6f1e8', '#0d0d0d': '#f6f1e8', '#0f0f0f': '#f2ebe0',
    '#111': '#fffdf9', '#111111': '#fffdf9', '#131313': '#fffdf9', '#141414': '#fffdf9', '#151515': '#fffdf9', '#161616': '#fffdf9',
    '#1a1a1a': '#efe8dd', '#1c1c1c': '#efe8dd', '#1f1f1f': '#efe8dd', '#242424': '#e6ddd0', '#2a2a2a': '#e6ddd0',
    '#1a1710': '#fbf1dd', '#221d13': '#fbf1dd', '#2a2111': '#fbf1dd', '#322a1b': '#f6e7c7', '#35221d': '#fbe9e4', '#1b120f': '#f6f1e8',
    '#123d38': '#dff1ed', '#101f1d': '#e8f5f1', '#10201d': '#e8f5f1', '#12302c': '#dff1ed', '#132a27': '#dff1ed',
  },
  text: {
    '#f2efea': '#16130f', '#f7eee7': '#16130f', '#fff': '#16130f', '#ffffff': '#16130f',
    '#e8dcc8': '#3a342d', '#e0e0dc': '#3a342d', '#d8d8d3': '#3a342d', '#c9c9c4': '#3a342d', '#c4c4c0': '#3a342d',
    '#b7b7b7': '#5c554c', '#b4b4b0': '#5c554c', '#aaa': '#5c554c', '#a8a8a8': '#5c554c', '#a8a8a4': '#5c554c', '#a0a0a0': '#5c554c', '#9a9a9a': '#5c554c', '#a9a9a9': '#5c554c', '#bbb': '#5c554c',
    '#8a8a86': '#6f675d', '#6a6a6a': '#6f675d', '#6b6b6b': '#6f675d', '#555': '#6f675d', '#666': '#6f675d', '#8f8f8f': '#6f675d', '#b09c8b': '#6f675d',
    '#2fb8a6': '#0f6f64', '#4cd0bd': '#0f6f64', '#8be6d8': '#0f6f64', '#77d2c4': '#0f6f64', '#83c3b8': '#0f6f64', '#c3dcd6': '#0f6f64',
    '#d9a441': '#8a5a0f', '#e2b04a': '#8a5a0f', '#e4c17b': '#8a5a0f',
    '#7fb069': '#336622', '#d96c5f': '#a63d30', '#e4b6a6': '#a63d30',
  },
  border: {
    '#111111': '#fffdf9', '#1f1f1f': '#e3d9cb', '#242424': '#e3d9cb', '#292929': '#e3d9cb', '#2a2a2a': '#e3d9cb', '#2f2f2f': '#ddd2c3', '#333': '#ddd2c3', '#222': '#e3d9cb', '#24433e': '#b9dcd5', '#665230': '#e2c98f',
    '#2fb8a6': '#0f6f64', '#4cd0bd': '#0f6f64', '#6a6a6a': '#b9ae9f', '#9a9a9a': '#b9ae9f',
  },
}
