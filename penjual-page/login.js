/**
 * File: penjual-page/login.js
 * PB-010, PB-030 (pesan galat bahasa Indonesia), PB-045 (peran pegawai/pemilik/kasir/dapur),
 * PB-065 (cek status aktif), PB-067 (verifikasi 2FA TOTP Supabase MFA).
 */
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    const errorMessage = document.getElementById('errorMessage');
    const btnSubmit = document.getElementById('btnSubmit');
    const stepCreds = document.getElementById('loginStepCredentials');
    const stepMfa = document.getElementById('loginStepMfa');
    const mfaCodeInput = document.getElementById('mfaCode');

    if (!loginForm) return;

    const ALLOWED_ROLES = ['pegawai', 'pemilik', 'kasir', 'dapur'];
    let pendingMfaFactorId = null;
    let pendingUser = null;
    let pendingProfile = null;

    function formatErr(err) {
        if (window.SabangdorErrors && typeof window.SabangdorErrors.formatError === 'function') {
            return window.SabangdorErrors.formatError(err, 'login');
        }
        return 'Email atau kata sandi salah.';
    }

    function showError(msg) {
        if (errorMessage) {
            errorMessage.textContent = msg;
            errorMessage.style.display = 'block';
        } else {
            alert(msg);
        }
    }

    function completeLogin(user, profile) {
        const userSession = {
            id: user.id,
            email: user.email,
            role: profile.role,
            username: profile.username || user.email
        };
        sessionStorage.setItem('sabangdor_logged_in', 'true');
        localStorage.setItem('pegawai_session', JSON.stringify(userSession));
        window.location.href = 'penjual-page/dashboard.html';
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (errorMessage) errorMessage.style.display = 'none';

        if (!window.supabaseClient) {
            showError('Tidak dapat terhubung, coba lagi.');
            return;
        }

        // Langkah 2: Verifikasi kode TOTP 2FA (PB-067)
        if (pendingMfaFactorId) {
            const code = (mfaCodeInput ? mfaCodeInput.value : '').replace(/\D/g, '');
            if (code.length !== 6) {
                showError('Masukkan 6 digit kode dari aplikasi Authenticator Anda.');
                return;
            }
            btnSubmit.disabled = true;
            btnSubmit.textContent = 'Memverifikasi 2FA...';
            try {
                const { data: chal, error: chalErr } = await window.supabaseClient.auth.mfa.challenge({
                    factorId: pendingMfaFactorId
                });
                if (chalErr) throw chalErr;

                const { error: verErr } = await window.supabaseClient.auth.mfa.verify({
                    factorId: pendingMfaFactorId,
                    challengeId: chal.id,
                    code: code
                });
                if (verErr) throw new Error('Kode verifikasi 2FA salah atau kedaluwarsa.');

                completeLogin(pendingUser, pendingProfile);
            } catch (err) {
                showError(err.message && /kode verifikasi/i.test(err.message) ? err.message : 'Kode verifikasi 2FA salah.');
                btnSubmit.disabled = false;
                btnSubmit.textContent = 'Verifikasi & Masuk';
            }
            return;
        }

        // Langkah 1: Validasi input & autentikasi email/password
        const emailInput = document.getElementById('email');
        const passwordInput = document.getElementById('password');
        if (!emailInput || !passwordInput) return;

        const email = emailInput.value.trim();
        const password = passwordInput.value;

        if (window.SabangdorValidation) {
            const check = window.SabangdorValidation.validateLoginInput(email, password);
            if (!check.valid) {
                showError(check.message);
                return;
            }
        } else if (!email || !password) {
            showError('Email dan kata sandi wajib diisi.');
            return;
        }

        btnSubmit.disabled = true;
        btnSubmit.textContent = 'Memeriksa...';

        try {
            const { data, error } = await window.supabaseClient.auth.signInWithPassword({
                email: email,
                password: password
            });

            if (error || !data || !data.user) {
                throw error || new Error('Invalid login credentials');
            }

            // Verifikasi profil pegawai & status aktif (PB-045, PB-065)
            let profile = null;
            const resFull = await window.supabaseClient
                .from('profiles')
                .select('role, username, is_active')
                .eq('id', data.user.id)
                .maybeSingle();

            if (resFull.error && /is_active/i.test(resFull.error.message || '')) {
                // Fallback jika migrasi v2 belum dijalankan
                const resLegacy = await window.supabaseClient
                    .from('profiles')
                    .select('role, username')
                    .eq('id', data.user.id)
                    .maybeSingle();
                profile = resLegacy.data;
            } else {
                profile = resFull.data;
            }

            if (!profile || !ALLOWED_ROLES.includes(String(profile.role || ''))) {
                await window.supabaseClient.auth.signOut();
                throw new Error('Akun ini tidak memiliki hak akses pegawai.');
            }
            if (profile.is_active === false) {
                await window.supabaseClient.auth.signOut();
                throw new Error('Akun pegawai ini sedang dinonaktifkan.');
            }

            // Cek apakah akun memiliki faktor 2FA TOTP terverifikasi (PB-067)
            if (window.supabaseClient.auth.mfa && typeof window.supabaseClient.auth.mfa.listFactors === 'function') {
                try {
                    const { data: factors } = await window.supabaseClient.auth.mfa.listFactors();
                    const verifiedTotp = (factors && factors.totp || []).find(f => f.status === 'verified');
                    if (verifiedTotp) {
                        pendingMfaFactorId = verifiedTotp.id;
                        pendingUser = data.user;
                        pendingProfile = profile;
                        if (stepCreds) stepCreds.style.display = 'none';
                        if (stepMfa) stepMfa.style.display = 'block';
                        btnSubmit.disabled = false;
                        btnSubmit.textContent = 'Verifikasi & Masuk';
                        if (mfaCodeInput) mfaCodeInput.focus();
                        return;
                    }
                } catch (mfaErr) {
                    // Lanjut normal jika proyek belum mengaktifkan MFA
                }
            }

            completeLogin(data.user, profile);
        } catch (err) {
            console.error('Login Error:', err);
            if (window.SabangdorTelemetry) window.SabangdorTelemetry.trackError('login', err);
            showError(formatErr(err));
            btnSubmit.disabled = false;
            btnSubmit.textContent = 'Masuk ke Dashboard';
        }
    });
});
