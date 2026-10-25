const fetch = require('node-fetch');

async function run() {
  const input = process.argv.slice(2).join(" ") || "No input";

  const res = await fetch("http://127.0.0.1:3000/api/paperclip", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input })
  });

  const data = await res.json();

  console.log("API Response:");
  console.log(JSON.stringify(data, null, 2));
}

run();
