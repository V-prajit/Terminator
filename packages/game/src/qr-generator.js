// qr-generator.js - Simple QR code generation for room joining
export class QRGenerator {
  constructor() {
    this.moduleSize = 4; // Size of each QR module in pixels
    this.quietZone = 4; // Border around QR code
  }

  // Generate a simple QR code for room joining URL
  generateRoomQR(roomId, baseUrl = window.location.origin) {
    const joinUrl = `${baseUrl}/mobile.html?room=${roomId}`;

    // For demo purposes, create a simple visual QR-like pattern
    // In production, you'd use a proper QR library like qrcode.js
    return this.createSimpleQR(joinUrl, roomId);
  }

  createSimpleQR(url, roomId) {
    const canvas = document.createElement('canvas');
    const size = 21; // 21x21 modules (Version 1 QR code size)
    const totalSize = (size + this.quietZone * 2) * this.moduleSize;

    canvas.width = totalSize;
    canvas.height = totalSize;

    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalSize, totalSize);

    // Black modules
    ctx.fillStyle = '#000000';

    // Create a deterministic pattern based on room ID
    const pattern = this.generatePattern(roomId, size);

    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (pattern[row][col]) {
          const x = (col + this.quietZone) * this.moduleSize;
          const y = (row + this.quietZone) * this.moduleSize;
          ctx.fillRect(x, y, this.moduleSize, this.moduleSize);
        }
      }
    }

    return {
      canvas,
      dataUrl: canvas.toDataURL(),
      url,
      roomId
    };
  }

  generatePattern(roomId, size) {
    // Create a deterministic pattern based on room ID
    const pattern = Array(size).fill().map(() => Array(size).fill(false));

    // Add finder patterns (corners)
    this.addFinderPattern(pattern, 0, 0);
    this.addFinderPattern(pattern, 0, size - 7);
    this.addFinderPattern(pattern, size - 7, 0);

    // Add timing patterns
    for (let i = 8; i < size - 8; i++) {
      pattern[6][i] = i % 2 === 0;
      pattern[i][6] = i % 2 === 0;
    }

    // Add data pattern based on room ID
    const roomHash = this.hashString(roomId);
    for (let i = 9; i < size - 9; i++) {
      for (let j = 9; j < size - 9; j++) {
        const index = i * (size - 18) + (j - 9);
        pattern[i][j] = (roomHash >> (index % 32)) & 1;
      }
    }

    return pattern;
  }

  addFinderPattern(pattern, startRow, startCol) {
    // 7x7 finder pattern
    const finderPattern = [
      [1,1,1,1,1,1,1],
      [1,0,0,0,0,0,1],
      [1,0,1,1,1,0,1],
      [1,0,1,1,1,0,1],
      [1,0,1,1,1,0,1],
      [1,0,0,0,0,0,1],
      [1,1,1,1,1,1,1]
    ];

    for (let i = 0; i < 7; i++) {
      for (let j = 0; j < 7; j++) {
        if (startRow + i < pattern.length && startCol + j < pattern[0].length) {
          pattern[startRow + i][startCol + j] = finderPattern[i][j] === 1;
        }
      }
    }
  }

  hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  // Create a more professional-looking QR code placeholder
  createProfessionalQR(roomId, baseUrl = window.location.origin) {
    const canvas = document.createElement('canvas');
    const size = 200;
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');

    // Gradient background
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, '#f8f9fa');
    gradient.addColorStop(1, '#e9ecef');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // Border
    ctx.strokeStyle = '#dee2e6';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, size - 2, size - 2);

    // QR-like pattern in center
    const patternSize = 120;
    const patternOffset = (size - patternSize) / 2;

    ctx.fillStyle = '#212529';

    // Create a grid pattern
    const cellSize = 8;
    const cells = patternSize / cellSize;

    for (let row = 0; row < cells; row++) {
      for (let col = 0; col < cells; col++) {
        // Use room ID to determine pattern
        const hash = this.hashString(roomId + row + col);
        if (hash % 3 === 0) {
          const x = patternOffset + col * cellSize;
          const y = patternOffset + row * cellSize;
          ctx.fillRect(x, y, cellSize - 1, cellSize - 1);
        }
      }
    }

    // Corner markers
    const markerSize = 20;
    ctx.fillStyle = '#007bff';

    // Top-left
    ctx.fillRect(patternOffset, patternOffset, markerSize, markerSize);
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(patternOffset + 6, patternOffset + 6, 8, 8);

    // Top-right
    ctx.fillStyle = '#007bff';
    ctx.fillRect(patternOffset + patternSize - markerSize, patternOffset, markerSize, markerSize);
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(patternOffset + patternSize - markerSize + 6, patternOffset + 6, 8, 8);

    // Bottom-left
    ctx.fillStyle = '#007bff';
    ctx.fillRect(patternOffset, patternOffset + patternSize - markerSize, markerSize, markerSize);
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(patternOffset + 6, patternOffset + patternSize - markerSize + 6, 8, 8);

    // Add text overlay
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fillRect(patternOffset + 30, patternOffset + patternSize - 40, 60, 30);

    ctx.fillStyle = '#212529';
    ctx.font = 'bold 12px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(roomId, patternOffset + 60, patternOffset + patternSize - 22);

    return {
      canvas,
      dataUrl: canvas.toDataURL(),
      url: `${baseUrl}/mobile.html?room=${roomId}`,
      roomId
    };
  }

  // Update QR code element with new room data
  updateQRElement(element, roomId, baseUrl) {
    const qrData = this.createProfessionalQR(roomId, baseUrl);

    if (element.tagName === 'CANVAS') {
      // Replace canvas content
      const ctx = element.getContext('2d');
      ctx.clearRect(0, 0, element.width, element.height);
      ctx.drawImage(qrData.canvas, 0, 0, element.width, element.height);
    } else {
      // Replace with image
      element.innerHTML = `
        <img src="${qrData.dataUrl}"
             alt="QR Code for Room ${roomId}"
             style="max-width: 100%; height: auto; border-radius: 8px;" />
      `;
    }

    return qrData;
  }

  // Generate QR code for display in dashboard
  generateDashboardQR(roomId) {
    const container = document.createElement('div');
    container.className = 'qr-container';

    const qrData = this.createProfessionalQR(roomId);

    container.innerHTML = `
      <div class="qr-image-container" style="text-align: center; margin-bottom: 15px;">
        <img src="${qrData.dataUrl}"
             alt="QR Code for Room ${roomId}"
             style="width: 150px; height: 150px; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.2);" />
      </div>
      <div class="qr-instructions" style="text-align: center; font-size: 14px; color: rgba(255,255,255,0.8);">
        <strong style="color: #00ffff;">Room: ${roomId}</strong><br>
        Scan with mobile device to join
      </div>
      <div class="qr-url" style="text-align: center; margin-top: 10px; font-size: 11px; color: rgba(255,255,255,0.6); word-break: break-all;">
        ${qrData.url}
      </div>
    `;

    return {
      element: container,
      qrData
    };
  }
}

export default QRGenerator;