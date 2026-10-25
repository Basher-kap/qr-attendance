import { toDataURL } from 'qrcode';

// "Ana Reyes" -> "Ana-Reyes"
export function fileSafe(text: string) {
  return (
    text
      .trim()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'student'
  );
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the QR image'));
    img.src = src;
  });
}

// Downloads a print-ready PNG: the QR code with the student's name and class below it.
export async function downloadStudentQr(fullName: string, className: string, token: string) {
  const size = 600;
  const labelHeight = 110;
  const qr = await loadImage(await toDataURL(token, { width: size, margin: 2 }));

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size + labelHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot create the image');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(qr, 0, 0, size, size);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(fullName, size / 2, size + 45, size - 40);
  ctx.fillStyle = '#555555';
  ctx.font = '26px sans-serif';
  ctx.fillText(className, size / 2, size + 85, size - 40);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not create the image');

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${fileSafe(fullName)}-QR.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
