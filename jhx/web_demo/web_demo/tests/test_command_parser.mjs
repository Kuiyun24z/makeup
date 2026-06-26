import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseMakeupCommand } from "../command_parser.mjs";

const catalog = JSON.parse(await readFile(new URL("../cosmetics.json", import.meta.url), "utf8"));

assert.equal(parseMakeupCommand("我现在适合什么妆？", catalog).type, "none");

const maple = parseMakeupCommand("试试枫叶红口红", catalog);
assert.equal(maple.type, "apply");
assert.equal(maple.category, "lip");
assert.equal(maple.item.id, "lip-maple");

const berry = parseMakeupCommand("换成姨妈色唇釉", catalog);
assert.equal(berry.type, "apply");
assert.equal(berry.item.id, "lip-berry");

const blush = parseMakeupCommand("试一下蜜桃腮红", catalog);
assert.equal(blush.type, "apply");
assert.equal(blush.category, "blush");
assert.equal(blush.item.id, "blush-peach");

const deeper = parseMakeupCommand("口红深一点", catalog);
assert.equal(deeper.type, "adjust");
assert.equal(deeper.target, "lip");
assert.equal(deeper.delta, 12);

const lighterBlush = parseMakeupCommand("腮红淡一点", catalog);
assert.equal(lighterBlush.type, "adjust");
assert.equal(lighterBlush.target, "blush");
assert.equal(lighterBlush.delta, -12);

assert.equal(parseMakeupCommand("卸妆", catalog).type, "clear");
assert.equal(parseMakeupCommand("恢复试妆", catalog).type, "restore");
assert.equal(parseMakeupCommand("试试银河灰口红", catalog).type, "unknownColor");

// Stage 6D: every family the rules engine can recommend must resolve to a catalog item
import { matchCatalogItem } from "../command_parser.mjs";
const ruleFamilies = [
  "珊瑚", "蜜桃", "砖红", "豆沙", "暖橘",
  "陶土", "深豆沙", "蓝粉", "玫红", "浆果",
  "蓝调正红", "酒红", "冷玫瑰", "玫瑰豆沙", "MLBB", "奶茶",
];
for (const family of ruleFamilies) {
  const item = matchCatalogItem(family, catalog, "lip");
  assert.ok(item, `rules family has no catalog match: ${family}`);
}

// Stage 6E: brow & eyeshadow categories
const earth = parseMakeupCommand("试试大地色眼影", catalog);
assert.equal(earth.type, "apply");
assert.equal(earth.category, "eyeshadow");
assert.equal(earth.item.id, "shadow-earth");

const brow = parseMakeupCommand("画个深棕眉毛", catalog);
assert.equal(brow.type, "apply");
assert.equal(brow.category, "brow");
assert.equal(brow.item.id, "brow-dark-brown");

const browDeeper = parseMakeupCommand("眉毛深一点", catalog);
assert.equal(browDeeper.type, "adjust");
assert.equal(browDeeper.target, "brow");

const shadowLighter = parseMakeupCommand("眼影淡一点", catalog);
assert.equal(shadowLighter.type, "adjust");
assert.equal(shadowLighter.target, "eyeshadow");

const blushMsg = parseMakeupCommand("试一下蜜桃腮红", catalog);
assert.equal(blushMsg.message.includes("腮红腮红"), false);

console.log("command parser ok");
