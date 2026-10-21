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
            // Simulasi pengecekan login lokal (ubah email & password sesuai kebutuhan)
            // Contoh akun pegawai: kasir@sabangdor.com / 123456
            const validEmail = "kasir@sabangdor.com";
            const validPassword = "123456";

            if (email !== validEmail || password !== validPassword) {
                throw new Error('Email atau kata sandi salah!');
            }

            // Simpan status sesi login lokal (opsional)
            sessionStorage.setItem("sabangdor_logged_in", "true");
            sessionStorage.setItem("sabangdor_user_email", email);

            // Redirect ke dashboard pegawai
            window.location.href = 'penjual-page/dashboard.html';

        } catch (err) {
            console.error('Login Error:', err);
            if (errorMessage) {
                errorMessage.innerText = err.message || 'Terjadi kesalahan sistem.';
                errorMessage.style.display = 'block';
            } else {
                alert(err.message || 'Terjadi kesalahan sistem.');
            }
            btnSubmit.disabled = false;
            btnSubmit.innerText = 'Masuk';
        }
    });
});
