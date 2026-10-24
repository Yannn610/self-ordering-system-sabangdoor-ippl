document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');
    const btnSubmit = document.getElementById('btnSubmit');

    if (!loginForm) return;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');

        if (!emailInput || !passwordInput) return;

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (errorMessage) errorMessage.style.display = 'none';
        btnSubmit.disabled = true;
        btnSubmit.innerText = 'Memeriksa...';

        try {
            // Panggil Backend API Express.js lokal
            const response = await fetch('http://localhost:5000/api/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || 'Email atau kata sandi salah!');
            }

            // Simpan sesi login lokal di browser
            localStorage.setItem('pegawai_session', JSON.stringify(data.user));

            // Redirect ke dashboard pegawai
            window.location.href = 'penjual-page/dashboard.html';

        } catch (err) {
            console.error('Login Error:', err);
            if (errorMessage) {
                errorMessage.innerText = err.message || 'Terjadi kesalahan sistem atau server lokal belum menyala.';
                errorMessage.style.display = 'block';
            } else {
                alert(err.message || 'Terjadi kesalahan sistem.');
            }
            btnSubmit.disabled = false;
            btnSubmit.innerText = 'Masuk';
        }
    });
});