// 로그인 페이지 JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    
    // 로그인 상태 확인
    if (isUserLoggedIn()) {
        window.location.href = '/';
        return;
    }
    
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const login = document.getElementById('login').value.trim();
        const password = document.getElementById('password').value;
        
        // 입력값 검증
        if (!login || !password) {
            alert('이메일/아이디와 비밀번호를 입력해주세요.');
            return;
        }
        
        try {
            const response = await fetch('/api/users/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ login, password })
            });
            
            // 429 Too Many Requests 오류 처리
            if (response.status === 429) {
                let errorMessage = '너무 많은 로그인 시도가 있었습니다. 잠시 후 다시 시도해주세요.';
                try {
                    const errorData = await response.json();
                    if (errorData.error) {
                        errorMessage = errorData.error;
                    }
                } catch (e) {
                    // JSON 파싱 실패 시 기본 메시지 사용
                }
                alert(errorMessage);
                return;
            }
            
            // 응답 본문을 안전하게 파싱
            let result;
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                try {
                    result = await response.json();
                } catch (jsonError) {
                    console.error('JSON 파싱 오류:', jsonError);
                    alert('서버 응답을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
                    return;
                }
            } else {
                // JSON이 아닌 경우 텍스트로 읽기
                const text = await response.text();
                alert(text || '알 수 없는 오류가 발생했습니다.');
                return;
            }
            
            if (result.success && result.token) {
                // 로그인 성공 - JWT 토큰 저장
                saveUserToken(result.token, result.user);
                window.location.href = '/';
            } else if (response.status === 403) {
                // 승인 대기 또는 거부 상태
                if (result.error === 'pending') {
                    showPendingModal();
                } else if (result.error === 'rejected') {
                    showRejectedModal();
                } else {
                    alert(result.error || result.message || '로그인할 수 없습니다.');
                }
            } else {
                alert(result.error || '로그인에 실패했습니다.');
            }
        } catch (error) {
            console.error('로그인 오류:', error);
            if (error instanceof SyntaxError) {
                alert('서버 응답을 처리하는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
            } else {
                alert('서버 연결에 실패했습니다.');
            }
        }
    });

    // 모달 닫기 버튼 이벤트 리스너
    const closePendingBtn = document.getElementById('closePendingModalBtn');
    const closeRejectedBtn = document.getElementById('closeRejectedModalBtn');
    
    if (closePendingBtn) {
        closePendingBtn.addEventListener('click', closePendingModal);
    }
    
    if (closeRejectedBtn) {
        closeRejectedBtn.addEventListener('click', closeRejectedModal);
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
}

function showRejectedModal() {
    const modal = document.getElementById('rejectedModal');
    if (modal) {
        modal.classList.add('modal-show');
        modal.style.display = 'flex';
    }
}

function closeRejectedModal() {
    const modal = document.getElementById('rejectedModal');
    if (modal) {
        modal.classList.remove('modal-show');
        modal.style.display = 'none';
    }
}
