document.addEventListener("DOMContentLoaded", () => {
  const footerHTML = `
    <footer class="main-footer">
      <div class="footer-content">
        <p class="copyright">
          &copy; 2026 Universidad Tecnológica de Puebla - SIDII. Todos los derechos reservados.
        </p>
        <div class="social-links">
          <a href="https://www.facebook.com/OficialUTP" target="_blank" rel="noopener noreferrer">Facebook</a>
          <a href="https://www.instagram.com/utpueblaoficial" target="_blank" rel="noopener noreferrer">Instagram</a>
          <a href="https://x.com/OficialUTP" target="_blank" rel="noopener noreferrer">X (Twitter)</a>
        </div>
      </div>
    </footer>
  `;
  
  // Agrega el footer automáticamente al final del body de cualquier página HTML
  document.body.insertAdjacentHTML("beforeend", footerHTML);
});