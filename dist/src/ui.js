/* ------------------------------------------------------------------ *
 * 界面：只保留操作提示、漂浮按键提示、对话与反馈
 * ------------------------------------------------------------------ */

const $ = (sel) => document.querySelector(sel);

const promptEl = $('#prompt');
const promptText = $('#prompt-text');
const dialogueEl = $('#dialogue');
const speakerEl = $('#speaker');
const dialogueText = $('#dialogue-text');
const noticeEl = $('#notice');
const noticeTitle = noticeEl.querySelector('h2');
const noticeBody = noticeEl.querySelector('.body');
const toastEl = $('#toast');
const hudEl = $('#hud');

let toastTimer = 0;
let dialogueTimer = 0;

export const ui = {
  promptVisible: false,
  noticeOpen: false,
  dialogueOpen: false,

  showPrompt(text, screenX, screenY) {
    if (promptText.textContent !== text) promptText.textContent = text;
    promptEl.style.left = `${screenX}px`;
    promptEl.style.top = `${screenY}px`;
    if (!this.promptVisible) {
      promptEl.classList.remove('hidden');
      void promptEl.offsetWidth;
      promptEl.classList.add('show');
      this.promptVisible = true;
    }
  },

  hidePrompt() {
    if (!this.promptVisible) return;
    promptEl.classList.remove('show');
    promptEl.classList.add('hidden');
    this.promptVisible = false;
  },

  say(name, text) {
    speakerEl.textContent = name;
    dialogueText.textContent = text;
    dialogueEl.classList.add('show');
    this.dialogueOpen = true;
    clearTimeout(dialogueTimer);
    dialogueTimer = setTimeout(() => ui.hideDialogue(), 15000);
  },

  hideDialogue() {
    clearTimeout(dialogueTimer);
    dialogueEl.classList.remove('show');
    this.dialogueOpen = false;
  },

  showNotice(title, lines) {
    noticeTitle.textContent = title;
    noticeBody.innerHTML = '';
    for (const line of lines) {
      const p = document.createElement('p');
      p.textContent = line;
      noticeBody.appendChild(p);
    }
    noticeEl.classList.add('show');
    this.noticeOpen = true;
    this.hidePrompt();
  },

  hideNotice() {
    noticeEl.classList.remove('show');
    this.noticeOpen = false;
  },

  toast(text, ms = 3200) {
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => toastEl.classList.add('hidden'), 220);
    }, ms);
  },

  hideLoading() {
    // 冷加载竞态兜底：#loading 可能已被 boot 的 5 秒揭幕兜底移除（模块图加载慢于它，
    // ui.js 初始化时元素已不在）——重新取一次，取不到就安全跳过。
    // ★别再回落到初始化时缓存的元素引用：被移除后那只是个游离节点，改它的样式没有意义。
    const el = document.getElementById('loading');
    if (el) {
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
    }
    setTimeout(() => { if (hudEl) hudEl.style.opacity = '0.72'; }, 9000);
  },

  /** 世界坐标投影到屏幕像素 */
  projectToScreen(vector, camera, width, height) {
    const v = vector.clone().project(camera);
    if (v.z > 1 || v.z < -1) return null;
    const x = (v.x * 0.5 + 0.5) * width;
    const y = (-v.y * 0.5 + 0.5) * height;
    if (x < -80 || x > width + 80 || y < -80 || y > height + 80) return null;
    return { x, y };
  },
};
