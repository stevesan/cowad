let toastTimer: ReturnType<typeof setTimeout>;

export function showToast(msg: string): void {
  const el = document.getElementById('toast')!;
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
