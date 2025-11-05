// 공통 인증 유틸리티 함수

// JWT 토큰 저장
function saveUserToken(token, userInfo) {
    localStorage.setItem('userToken', token);
    localStorage.setItem('userInfo', JSON.stringify(userInfo));
    localStorage.setItem('userLoggedIn', 'true');
}

function saveAdminToken(token, adminInfo) {
    localStorage.setItem('adminToken', token);
    localStorage.setItem('adminInfo', JSON.stringify(adminInfo));
    localStorage.setItem('adminLoggedIn', 'true');
}

// JWT 토큰 가져오기
function getUserToken() {
    return localStorage.getItem('userToken');
}

function getAdminToken() {
    return localStorage.getItem('adminToken');
}

// 로그인 상태 확인
function isUserLoggedIn() {
    return !!getUserToken();
}

function isAdminLoggedIn() {
    return !!getAdminToken();
}

// 로그아웃
function logoutUser() {
    localStorage.removeItem('userToken');
    localStorage.removeItem('userInfo');
    localStorage.removeItem('userLoggedIn');
}

function logoutAdmin() {
    localStorage.removeItem('adminToken');
    localStorage.removeItem('adminInfo');
    localStorage.removeItem('adminLoggedIn');
}

// 인증 헤더 포함한 fetch
async function authenticatedFetch(url, options = {}) {
    const token = getUserToken();
    if (!token) {
        throw new Error('인증이 필요합니다.');
    }
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
    };
    
    return fetch(url, {
        ...options,
        headers
    });
}

// 관리자 토큰 만료 확인
function isAdminTokenExpired() {
    const token = getAdminToken();
    if (!token) return true;
    
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const now = Math.floor(Date.now() / 1000);
        return payload.exp && payload.exp < now;
    } catch (e) {
        return true;
    }
}

// 관리자 인증 헤더 포함한 fetch (보안 강화)
async function adminAuthenticatedFetch(url, options = {}) {
    const token = getAdminToken();
    if (!token) {
        logoutAdmin();
        window.location.href = '/admin';
        throw new Error('관리자 인증이 필요합니다.');
    }
    
    // 토큰 만료 확인
    if (isAdminTokenExpired()) {
        logoutAdmin();
        alert('세션이 만료되었습니다. 다시 로그인해주세요.');
        window.location.href = '/admin';
        throw new Error('세션이 만료되었습니다.');
    }
    
    // FormData인 경우 Content-Type 헤더를 설정하지 않음 (브라우저가 자동으로 boundary 설정)
    const isFormData = options.body instanceof FormData;
    
    const headers = {
        'Authorization': `Bearer ${token}`,
        ...options.headers
    };
    
    // FormData가 아닐 때만 Content-Type을 application/json으로 설정
    if (!isFormData && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    
    const response = await fetch(url, {
        ...options,
        headers
    });
    
    // 401 Unauthorized 응답 시 자동 로그아웃
    if (response.status === 401) {
        let errorMessage = '인증이 만료되었습니다. 다시 로그인해주세요.';
        try {
            const errorData = await response.clone().json();
            if (errorData.sessionTerminated) {
                errorMessage = '다른 위치에서 로그인하여 세션이 종료되었습니다. 다시 로그인해주세요.';
            } else if (errorData.error) {
                errorMessage = errorData.error;
            }
        } catch (e) {
            // JSON 파싱 실패 시 기본 메시지 사용
        }
        
        logoutAdmin();
        alert(errorMessage);
        window.location.href = '/admin';
        throw new Error(errorMessage);
    }
    
    return response;
}

// XSS 방지를 위한 텍스트 이스케이프
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 텍스트를 안전하게 HTML에 삽입
function safeHtmlInsert(element, text) {
    if (element) {
        element.textContent = text;
    }
}

