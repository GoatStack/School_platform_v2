// 회원가입 페이지 JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const signupForm = document.getElementById('signupForm');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const passwordStatus = document.getElementById('passwordMatchStatus');
    
    // 실시간 비밀번호 확인
    function checkPasswordMatch() {
        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;
        
        if (confirmPassword === '') {
            passwordStatus.textContent = '';
            passwordStatus.className = 'password-status';
            return;
        }
        
        if (password === confirmPassword) {
            passwordStatus.textContent = '일치합니다';
            passwordStatus.className = 'password-status success';
        } else {
            passwordStatus.textContent = '비밀번호가 일치하지 않습니다';
            passwordStatus.className = 'password-status error';
        }
    }
    
    // 비밀번호 입력 시 실시간 확인
    passwordInput.addEventListener('input', checkPasswordMatch);
    confirmPasswordInput.addEventListener('input', checkPasswordMatch);
    
    signupForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // 비밀번호 확인
        const password = document.getElementById('password').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        
        if (password !== confirmPassword) {
            alert('비밀번호가 일치하지 않습니다.');
            return;
        }
        
        // 폼 데이터 수집
        const formData = new FormData(signupForm);
        const username = formData.get('username')?.trim() || '';
        
        // 아이디 검증
        if (!username || !/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
            alert('아이디는 3~20자의 영문, 숫자, _, - 만 사용 가능합니다.');
            return;
        }
        
        const data = {
            email: formData.get('email'),
            username: username,
            password: formData.get('password'),
            fullName: formData.get('fullName'),
            grade: formData.get('grade'),
            className: formData.get('className'),
            studentNumber: parseInt(formData.get('studentNumber'))
        };
        
        try {
            const response = await fetch('/api/users/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            
            const result = await response.json();
            
            if (result.success) {
                // 회원가입 성공 모달 표시
                showPendingModal();
            } else {
                alert(result.error || '회원가입에 실패했습니다.');
            }
        } catch (error) {
            console.error('회원가입 오류:', error);
            alert('서버 연결에 실패했습니다.');
        }
    });

    // 모달 닫기 버튼 이벤트 리스너
    const closePendingBtn = document.getElementById('closePendingModalBtn');
    
    if (closePendingBtn) {
        closePendingBtn.addEventListener('click', closePendingModal);
    }
});

function showPendingModal() {
    const modal = document.getElementById('pendingModal');
    if (modal) {
        modal.classList.add('modal-show');
        modal.style.display = 'flex';
    }
}

function closePendingModal() {
    const modal = document.getElementById('pendingModal');
    if (modal) {
        modal.classList.remove('modal-show');
        modal.style.display = 'none';
    }
    // 메인 페이지로 이동
    window.location.href = '/';
}
