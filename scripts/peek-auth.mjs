import fs from "node:fs";

const js = fs.readFileSync(process.env.TEMP + "/aitu-index.js", "utf8");

function show(needle, before = 350, after = 800, limit = 3) {
  let index = 0;
  let count = 0;
  while ((index = js.indexOf(needle, index)) !== -1 && count < limit) {
    console.log(`\n==== ${needle} #${count} @${index} ====`);
    console.log(js.slice(Math.max(0, index - before), index + after));
    index += needle.length;
    count += 1;
  }
  if (count === 0) console.log("NO", needle);
}

let index = 0;
let count = 0;
const needle = "getPassportLoginURL(";
while ((index = js.indexOf(needle, index)) !== -1 && count < 8) {
  console.log("\n@", index);
  console.log(js.slice(index, index + 450));
  index += needle.length;
  count += 1;
}
console.log("count", count);
