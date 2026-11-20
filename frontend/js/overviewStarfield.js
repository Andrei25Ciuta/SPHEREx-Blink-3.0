window.createOverviewStarfield = function (THREE) {
    const starCount = 6500;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starCol = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i*3] = (Math.random() - 0.5) * 2200;
      starPos[i*3+1] = (Math.random() - 0.5) * 2200;
      starPos[i*3+2] = (Math.random() - 0.5) * 2200;

      if (Math.random() < 0.12) {
        starCol[i*3] = 0.94; starCol[i*3+1] = 0.70; starCol[i*3+2] = 0.31; // gold
      } else if (Math.random() < 0.08) {
        starCol[i*3] = 0.5; starCol[i*3+1] = 0.7; starCol[i*3+2] = 1.0;   // blue-white
      } else {
        const b = 0.65 + Math.random() * 0.35;
        starCol[i*3] = b; starCol[i*3+1] = b; starCol[i*3+2] = b;
      }
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
    const starMat = new THREE.PointsMaterial({ size: 1.6, vertexColors: true, transparent: true, opacity: 0.85 });
    return new THREE.Points(starGeo, starMat);
};
