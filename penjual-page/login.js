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
            // Pastikan supabaseClient sudah siap dari config.s
            if (!window.supabaseClient) {
                throw new Error("Supabase client belum terinisialisasi dengan benar.");
            }

            // Autentikasi langsung menggunakan Supabase Auth
            const { data, error } = await window.supabaseClient.auth.signInWithPassword({
                email: email,
                password: password,
            });

            if (error) {
                throw new Error(error.message || 'Email atau kata sandi salah!');
            }

            // Simpan sesi login di browser (Session & Local Storage)
            const userSession = {
                id: data.user.id,
                email: data.user.email,
                role: 'pegawai'
            };

            sessionStorage.setItem("sabangdor_logged_in", "true");
            localStorage.setItem('pegawai_session', JSON.stringify(userSession));

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