// 관리자 페이지 JavaScript

document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const adminDashboard = document.getElementById('adminDashboard');
    const adminLoginForm = document.getElementById('adminLoginForm');
    const logoutBtn = document.getElementById('logoutBtn');
    
    // 로그인 상태 확인 (토큰 만료 확인 포함)
    if (isAdminLoggedIn() && !isAdminTokenExpired()) {
        showDashboard();
        loadDashboardData();
        setupSidebarNavigation();
        setupTabNavigation();
        setupSidebarToggle();
        setupSettingsForms();
        
        // 토큰 만료 및 세션 무효화 주기적 확인 (1분마다)
        setInterval(async () => {
            if (isAdminTokenExpired()) {
                logoutAdmin();
                alert('세션이 만료되었습니다. 다시 로그인해주세요.');
                window.location.href = '/admin';
                return;
            }
            
            // 세션 유효성 확인 (서버에 직접 요청 - adminAuthenticatedFetch 사용하지 않음)
            try {
                const token = getAdminToken();
                if (!token) return;
                
                const response = await fetch('/api/stats', {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    }
                });
                
                if (response.status === 401) {
                    // 세션이 무효화됨 (다른 PC에서 로그인 또는 토큰 만료)
                    let errorMessage = '세션이 만료되었습니다. 다시 로그인해주세요.';
                    try {
                        const errorData = await response.json();
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
                }
            } catch (error) {
                // 네트워크 오류 등은 무시 (다음 확인 때 다시 시도)
                console.error('세션 확인 오류:', error);
            }
        }, 60 * 1000); // 1분마다 확인
    } else if (isAdminLoggedIn() && isAdminTokenExpired()) {
        // 만료된 토큰 정리
        logoutAdmin();
        showLoginForm();
    }

    // 1단계 로그인 폼 제출 (사용자명/비밀번호)
    adminLoginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const username = document.getElementById('adminUsername').value.trim();
        const password = document.getElementById('adminPassword').value;
        
        // 입력값 검증
        if (!username || !password) {
            alert('사용자명과 비밀번호를 입력해주세요.');
            return false;
        }
        
        try {
            const response = await fetch('/api/admin/login-step1', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success && result.sessionId) {
                // 1단계 성공 - 세션 ID 저장하고 PIN 입력 폼 표시
                window.tempAdminSessionId = result.sessionId;
                showPinForm();
            } else {
                alert(result.error || '로그인에 실패했습니다.');
            }
        } catch (error) {
            console.error('로그인 오류:', error);
            alert(error.message || '서버 연결에 실패했습니다.');
        }
        
        return false;
    });

    // PIN 폼 제출 (2단계)
    const adminPinForm = document.getElementById('adminPinForm');
    if (adminPinForm) {
        adminPinForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            const pin = document.getElementById('adminPin').value.trim();
            
            if (!pin) {
                alert('PIN을 입력해주세요.');
                return false;
            }
            
            // PIN 숫자 검증
            if (!/^\d+$/.test(pin)) {
                alert('PIN은 숫자만 입력 가능합니다.');
                return false;
            }
            
            if (pin.length < 4 || pin.length > 6) {
                alert('PIN은 4~6자리 숫자여야 합니다.');
                return false;
            }
            
            if (!window.tempAdminSessionId) {
                alert('인증 세션이 만료되었습니다. 다시 로그인해주세요.');
                showLoginForm();
                return false;
            }
            
            try {
                const response = await fetch('/api/admin/login-step2', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ sessionId: window.tempAdminSessionId, pin })
                });
                
                // PIN 오류는 정상적인 보안 응답 (401)이므로 에러로 처리하지 않음
                if (!response.ok) {
                    let errorData;
                    try {
                        errorData = await response.json();
                    } catch (e) {
                        errorData = { error: '서버 오류가 발생했습니다.' };
                    }
                    
                    // PIN 시도 횟수 초과 시 로그인 폼으로 돌아가기
                    if (errorData.error && errorData.error.includes('시도 횟수를 초과')) {
                        window.tempAdminSessionId = null;
                        alert(errorData.error);
                        showLoginForm();
                        return false;
                    }
                    
                    // PIN 오류는 사용자에게만 알림 (콘솔 에러는 표시하지 않음)
                    alert(errorData.error || 'PIN이 올바르지 않습니다.');
                    return false;
                }
                
                const result = await response.json();
                
                if (result.success && result.token) {
                    // 로그인 성공 - 최종 토큰 저장
                    window.tempAdminSessionId = null; // 세션 ID 제거
                    saveAdminToken(result.token, result.admin);
                    showDashboard();
                    loadDashboardData();
                    
                    // 사이드바 네비게이션 및 설정 초기화
                    setupSidebarNavigation();
                    setupTabNavigation();
                    setupSidebarToggle();
                    setupSettingsForms();
                    
                    // 초기 데이터 로드
                    loadAllUserData();
                } else {
                    alert(result.error || '로그인에 실패했습니다.');
                }
            } catch (error) {
                // 네트워크 오류 등 실제 예외 상황만 콘솔에 기록
                if (!error.message.includes('PIN이 올바르지') && !error.message.includes('시도 횟수')) {
                    console.error('PIN 인증 오류:', error);
                }
                
                // 세션 만료 등의 경우
                if (error.message.includes('만료') || error.message.includes('유효하지') || error.message.includes('시도 횟수를 초과')) {
                    window.tempAdminSessionId = null; // 세션 ID 제거
                    alert(error.message || '인증 세션이 만료되었습니다. 다시 로그인해주세요.');
                    showLoginForm();
                } else if (!error.message.includes('PIN이 올바르지')) {
                    // PIN 오류가 아닌 경우에만 알림
                    alert(error.message || '서버 연결에 실패했습니다.');
                }
            }
            
            return false;
        });
    }


    // 로그아웃 버튼 설정 (대시보드 표시 후 다시 설정)
    function setupLogoutButton() {
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            // 기존 이벤트 리스너 제거 후 새로 추가
            logoutBtn.replaceWith(logoutBtn.cloneNode(true));
            const newLogoutBtn = document.getElementById('logoutBtn');
            
            newLogoutBtn.addEventListener('click', async function(e) {
                e.preventDefault();
                e.stopPropagation();
                
                try {
                    // 서버에 로그아웃 요청 (세션 토큰 초기화)
                    await adminAuthenticatedFetch('/api/admin/logout', {
                        method: 'POST'
                    });
                } catch (error) {
                    // 로그아웃 실패해도 클라이언트 측 로그아웃은 진행
                    console.error('로그아웃 요청 오류:', error);
                }
                
                logoutAdmin();
                showLoginForm();
            });
        }
    }

    // 로그아웃 (초기 로드 시)
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async function(e) {
            e.preventDefault();
            e.stopPropagation();
            
            try {
                // 서버에 로그아웃 요청 (세션 토큰 초기화)
                await adminAuthenticatedFetch('/api/admin/logout', {
                    method: 'POST'
                });
            } catch (error) {
                // 로그아웃 실패해도 클라이언트 측 로그아웃은 진행
                console.error('로그아웃 요청 오류:', error);
            }
            
            logoutAdmin();
            showLoginForm();
        });
    }

    // 대시보드 표시
    function showDashboard() {
        loginForm.style.display = 'none';
        const pinForm = document.getElementById('pinForm');
        if (pinForm) pinForm.style.display = 'none';
        adminDashboard.style.display = 'block';
        
        // 로그아웃 버튼 이벤트 리스너 재설정
        setupLogoutButton();
    }

    // 로그인 폼 표시 (1단계)
    function showLoginForm() {
        loginForm.style.display = 'block';
        const pinForm = document.getElementById('pinForm');
        if (pinForm) pinForm.style.display = 'none';
        adminDashboard.style.display = 'none';
        // 폼 초기화
        document.getElementById('adminUsername').value = '';
        document.getElementById('adminPassword').value = '';
        if (document.getElementById('adminPin')) {
            document.getElementById('adminPin').value = '';
        }
        window.tempAdminSessionId = null;
    }

    // PIN 폼 표시 (2단계)
    function showPinForm() {
        loginForm.style.display = 'none';
        const pinForm = document.getElementById('pinForm');
        if (pinForm) {
            pinForm.style.display = 'block';
            // PIN 입력 필드에 포커스
            setTimeout(() => {
                const pinInput = document.getElementById('adminPin');
                if (pinInput) pinInput.focus();
            }, 100);
        }
        adminDashboard.style.display = 'none';
    }

    // 대시보드 데이터 로드
    async function loadDashboardData() {
        try {
            // 통계 정보 로드
            const statsResponse = await adminAuthenticatedFetch('/api/stats');
            
            if (!statsResponse.ok) {
                throw new Error(`HTTP error! status: ${statsResponse.status}`);
            }
            
            const stats = await statsResponse.json();
            
            // 통계 업데이트 (요소가 존재할 때만)
            const pendingCountEl = document.getElementById('pendingCount');
            const approvedCountEl = document.getElementById('approvedCount');
            
            if (pendingCountEl) {
                pendingCountEl.textContent = stats.pending;
            }
            if (approvedCountEl) {
                approvedCountEl.textContent = stats.approved;
            }

            // 사용자 목록 로드
            await loadUsers();
            
            // 대기 중인 신청 목록 로드
            await loadApplications();
            
            // 승인된 프로젝트 목록 로드
            await loadApprovedProjects();
            
        } catch (error) {
            console.error('데이터 로드 오류:', error);
        }
    }

    // 설정 폼 처리
    function setupSettingsForms() {
        // 사용자명 변경 폼
        const changeUsernameForm = document.getElementById('changeUsernameForm');
        if (changeUsernameForm) {
            changeUsernameForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const currentPassword = document.getElementById('currentPasswordForUsername').value;
                const newUsername = document.getElementById('newUsername').value.trim();
                
                if (!currentPassword || !newUsername) {
                    alert('모든 필드를 입력해주세요.');
                    return;
                }
                
                if (newUsername.length < 3 || newUsername.length > 20) {
                    alert('사용자명은 3~20자 사이여야 합니다.');
                    return;
                }
                
                try {
                    const response = await adminAuthenticatedFetch('/api/admin/change-username', {
                        method: 'POST',
                        body: JSON.stringify({ currentPassword, newUsername })
                    });
                    
                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error || '사용자명 변경에 실패했습니다.');
                    }
                    
                    const result = await response.json();
                    alert(result.message || '사용자명이 성공적으로 변경되었습니다.');
                    
                    // 폼 초기화
                    changeUsernameForm.reset();
                    
                    // 사용자명 변경 시 로그아웃 처리
                    if (result.success) {
                        alert('사용자명이 변경되었습니다. 다시 로그인해주세요.');
                        logoutAdmin();
                        window.location.href = '/admin';
                    }
                } catch (error) {
                    console.error('사용자명 변경 오류:', error);
                    alert(error.message || '사용자명 변경 중 오류가 발생했습니다.');
                }
            });
        }
        
        // 비밀번호 변경 폼
        const changePasswordForm = document.getElementById('changePasswordForm');
        if (changePasswordForm) {
            changePasswordForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const currentPassword = document.getElementById('currentPassword').value;
                const newPassword = document.getElementById('newPassword').value;
                const confirmNewPassword = document.getElementById('confirmNewPassword').value;
                
                if (!currentPassword || !newPassword || !confirmNewPassword) {
                    alert('모든 필드를 입력해주세요.');
                    return;
                }
                
                if (newPassword.length < 8) {
                    alert('새 비밀번호는 최소 8자 이상이어야 합니다.');
                    return;
                }
                
                if (newPassword !== confirmNewPassword) {
                    alert('새 비밀번호가 일치하지 않습니다.');
                    return;
                }
                
                try {
                    const response = await adminAuthenticatedFetch('/api/admin/change-password', {
                        method: 'POST',
                        body: JSON.stringify({ currentPassword, newPassword, confirmPassword: confirmNewPassword })
                    });
                    
                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error || '비밀번호 변경에 실패했습니다.');
                    }
                    
                    const result = await response.json();
                    alert(result.message || '비밀번호가 성공적으로 변경되었습니다.');
                    
                    // 폼 초기화
                    changePasswordForm.reset();
                } catch (error) {
                    console.error('비밀번호 변경 오류:', error);
                    alert(error.message || '비밀번호 변경 중 오류가 발생했습니다.');
                }
            });
        }
        
        // PIN 변경 폼
        const changePinForm = document.getElementById('changePinForm');
        if (changePinForm) {
            changePinForm.addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const currentPin = document.getElementById('currentPinForChange').value.trim();
                const newPin = document.getElementById('newPin').value.trim();
                const confirmNewPin = document.getElementById('confirmNewPin').value.trim();
                
                if (!currentPin || !newPin || !confirmNewPin) {
                    alert('모든 필드를 입력해주세요.');
                    return;
                }
                
                if (!/^\d+$/.test(currentPin) || !/^\d+$/.test(newPin) || !/^\d+$/.test(confirmNewPin)) {
                    alert('PIN은 숫자만 입력 가능합니다.');
                    return;
                }
                
                if (newPin.length < 4 || newPin.length > 6) {
                    alert('새 PIN은 4~6자리 숫자여야 합니다.');
                    return;
                }
                
                if (newPin !== confirmNewPin) {
                    alert('새 PIN이 일치하지 않습니다.');
                    return;
                }
                
                try {
                    const response = await adminAuthenticatedFetch('/api/admin/change-pin', {
                        method: 'POST',
                        body: JSON.stringify({ currentPin, newPin, confirmNewPin })
                    });
                    
                    if (!response.ok) {
                        const errorData = await response.json();
                        throw new Error(errorData.error || 'PIN 변경에 실패했습니다.');
                    }
                    
                    const result = await response.json();
                    alert(result.message || 'PIN이 성공적으로 변경되었습니다.');
                    
                    // 폼 초기화
                    changePinForm.reset();
                } catch (error) {
                    console.error('PIN 변경 오류:', error);
                    alert(error.message || 'PIN 변경 중 오류가 발생했습니다.');
                }
            });
        }
    }

    // 사이드바 네비게이션 설정
    function setupSidebarNavigation() {
        const navItems = document.querySelectorAll('.nav-item');
        const contentSections = document.querySelectorAll('.content-section');

        if (navItems.length === 0 || contentSections.length === 0) {
            console.error('네비게이션 요소를 찾을 수 없습니다.');
            return;
        }

        navItems.forEach(item => {
            item.addEventListener('click', () => {
                const section = item.dataset.section;
                
                // data-section이 없거나 로그아웃 버튼인 경우 처리하지 않음
                if (!section || item.classList.contains('logout-nav-item')) {
                    return;
                }
                
                // 해당 섹션 요소가 존재하는지 확인
                const targetSection = document.getElementById(section + 'Section');
                if (!targetSection) {
                    console.warn(`섹션을 찾을 수 없습니다: ${section}Section`);
                    return;
                }
                
                // 모든 네비게이션 아이템 비활성화
                navItems.forEach(nav => nav.classList.remove('active'));
                // 클릭된 아이템 활성화
                item.classList.add('active');
                
                // 모든 콘텐츠 섹션 숨기기
                contentSections.forEach(section => section.classList.remove('active'));
                // 해당 섹션 표시
                targetSection.classList.add('active');
            });
        });
    }


    // 사이드바 토글 기능
    function setupSidebarToggle() {
        const sidebarToggle = document.getElementById('sidebarToggle');
        const sidebarClose = document.getElementById('sidebarClose');
        const adminSidebar = document.getElementById('adminSidebar');
        const sidebarOverlay = document.getElementById('sidebarOverlay');

        if (!sidebarToggle || !sidebarClose || !adminSidebar || !sidebarOverlay) {
            console.error('사이드바 요소를 찾을 수 없습니다.');
            return;
        }

        // 사이드바 열기
        sidebarToggle.addEventListener('click', () => {
            adminSidebar.classList.add('open');
            sidebarOverlay.classList.add('open');
            sidebarToggle.classList.add('sidebar-open');
            document.body.style.overflow = 'hidden'; // 스크롤 방지
            // 사이드바가 열릴 때 햄버거 메뉴 숨기기
            sidebarToggle.style.opacity = '0';
            sidebarToggle.style.pointerEvents = 'none';
        });

        // 사이드바 닫기 함수
        function closeSidebar() {
            adminSidebar.classList.remove('open');
            sidebarOverlay.classList.remove('open');
            sidebarToggle.classList.remove('sidebar-open');
            document.body.style.overflow = ''; // 스크롤 복원
            // 사이드바가 닫힐 때 햄버거 메뉴 다시 보이기
            sidebarToggle.style.opacity = '1';
            sidebarToggle.style.pointerEvents = 'auto';
        }

        // 사이드바 닫기 버튼
        sidebarClose.addEventListener('click', closeSidebar);

        // 오버레이 클릭 시 닫기
        sidebarOverlay.addEventListener('click', closeSidebar);

        // ESC 키로 닫기
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && adminSidebar.classList.contains('open')) {
                closeSidebar();
            }
        });
    }

    // 승인된 사용자만 로드
    async function loadApprovedUsersOnly() {
        try {
            const response = await adminAuthenticatedFetch('/api/users');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const users = await response.json();
            const approvedUsers = users.filter(user => user.status === 'approved');
            const approvedContainer = document.getElementById('approvedUsers');
            const approvedCountElement = document.getElementById('approvedUsersCount');
            
            if (approvedCountElement) {
                approvedCountElement.textContent = approvedUsers.length;
            }
            
            if (approvedContainer) {
                if (approvedUsers.length === 0) {
                    approvedContainer.innerHTML = '<div class="empty-state">승인된 사용자가 없습니다.</div>';
                } else {
                    approvedContainer.innerHTML = approvedUsers.map(user => {
                        const createdDate = new Date(user.created_at).toLocaleDateString('ko-KR');
                        const approvedDate = user.approved_at ? new Date(user.approved_at).toLocaleDateString('ko-KR') : '알 수 없음';
                        
                        return `
                        <div class="application-card" data-id="${user.id}">
                            <div class="application-header">
                                <h4 class="application-title">${user.full_name}</h4>
                                <span class="application-status status-approved">승인됨</span>
                            </div>
                            
                            <div class="application-info">
                                <div class="info-item">
                                    <span class="info-label">이메일</span>
                                    <span class="info-value">${user.email}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">학년/반/번호</span>
                                    <span class="info-value">${user.grade}학년 ${user.class_name}반 ${user.student_number}번</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">가입일</span>
                                    <span class="info-value">${createdDate}</span>
                                </div>
                                <div class="info-item">
                                    <span class="info-label">승인일</span>
                                    <span class="info-value">${approvedDate}</span>
                                </div>
                            </div>
                            
                            <div class="application-actions">
                                <button class="btn-reject" data-action="reject-user" data-user-id="${user.id}">승인 취소</button>
                            </div>
                        </div>
                    `;
                    }).join('');
                }
            }
            
        } catch (error) {
            console.error('승인된 사용자 목록 로드 오류:', error);
        }
    }

    // 사용자 목록 로드
    async function loadUsers() {
        try {
            const response = await adminAuthenticatedFetch('/api/users');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const users = await response.json();
            
            // 대기 중인 사용자 처리
            const pendingUsers = users.filter(user => user.status === 'pending');
            const pendingUsersHTML = pendingUsers.length === 0 
                ? '<div class="empty-state">승인 대기 중인 사용자가 없습니다.</div>'
                : pendingUsers.map(user => {
                    const createdDate = new Date(user.created_at).toLocaleDateString('ko-KR');
                    
                    return `
                    <div class="application-card user-card" data-id="${user.id}" data-user-id="${user.id}" style="cursor: pointer;">
                        <div class="application-header">
                            <h4 class="application-title">${user.full_name}</h4>
                            <span class="application-status status-pending">승인 대기</span>
                        </div>
                        
                        <div class="application-info">
                            <div class="info-item">
                                <span class="info-label">이메일</span>
                                <span class="info-value">${escapeHtml(user.email || '')}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">아이디</span>
                                <span class="info-value">${escapeHtml(user.username || '미설정')}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">학년/반/번호</span>
                                <span class="info-value">${user.grade}학년 ${user.class_name}반 ${user.student_number}번</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">가입일</span>
                                <span class="info-value">${createdDate}</span>
                            </div>
                        </div>
                        
                    <div class="application-actions">
                        <button class="btn-approve" data-action="approve-user" data-user-id="${user.id}">승인</button>
                        <button class="btn-reject" data-action="reject-user" data-user-id="${user.id}">거부</button>
                    </div>
                    </div>
                `;
                }).join('');
            
            // 대기 중인 사용자 탭에만 표시
            const pendingContainer = document.getElementById('pendingUsers');
            if (pendingContainer) {
                pendingContainer.innerHTML = pendingUsersHTML;
            }
            
            // 카운트 업데이트
            document.getElementById('pendingUsersCount').textContent = pendingUsers.length;
            
            // 거부된 사용자 처리
            const rejectedUsers = users.filter(user => user.status === 'rejected');
            const rejectedUsersHTML = rejectedUsers.length === 0 
                ? '<div class="empty-state">거부된 사용자가 없습니다.</div>'
                : rejectedUsers.map(user => {
                    const createdDate = new Date(user.created_at).toLocaleDateString('ko-KR');
                    
                    return `
                    <div class="application-card user-card" data-id="${user.id}" data-user-id="${user.id}" style="cursor: pointer;">
                        <div class="application-header">
                            <h4 class="application-title">${user.full_name}</h4>
                            <span class="application-status" style="background: #f44336; color: white;">거부됨</span>
                        </div>
                        
                        <div class="application-info">
                            <div class="info-item">
                                <span class="info-label">이메일</span>
                                <span class="info-value">${escapeHtml(user.email || '')}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">아이디</span>
                                <span class="info-value">${escapeHtml(user.username || '미설정')}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">학년/반/번호</span>
                                <span class="info-value">${user.grade}학년 ${user.class_name}반 ${user.student_number}번</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">가입일</span>
                                <span class="info-value">${createdDate}</span>
                            </div>
                        </div>
                        
                    <div class="application-actions">
                        <button class="btn-approve" data-action="approve-user" data-user-id="${user.id}">다시 승인</button>
                    </div>
                    </div>
                `;
                }).join('');
            
            // 거부된 사용자 탭에 표시
            const rejectedContainer = document.getElementById('rejectedUsers');
            if (rejectedContainer) {
                rejectedContainer.innerHTML = rejectedUsersHTML;
            }
            
            // 거부된 사용자 카운트 업데이트
            const rejectedCountEl = document.getElementById('rejectedUsersCount');
            if (rejectedCountEl) {
                rejectedCountEl.textContent = rejectedUsers.length;
            }
            
        } catch (error) {
            console.error('사용자 목록 로드 오류:', error);
        }
    }

    // 대기 중인 신청 목록 로드
    async function loadApplications() {
        try {
            const response = await adminAuthenticatedFetch('/api/applications');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const applications = await response.json();
            
            const pendingApplications = applications.filter(app => app.status === 'pending');
            const container = document.getElementById('pendingApplications');
            const container2 = document.getElementById('pendingApplications2');
            
            const pendingApplicationsHTML = pendingApplications.length === 0 
                ? '<div class="empty-state">대기 중인 신청이 없습니다.</div>'
                : pendingApplications.map(app => {
                // 날짜 포맷팅 (YYYY-MM-DD)
                const createdAt = new Date(app.created_at);
                const formattedDate = createdAt.getFullYear() + '-' + 
                                      String(createdAt.getMonth() + 1).padStart(2, '0') + '-' + 
                                      String(createdAt.getDate()).padStart(2, '0');
                
                return `
                <div class="application-card" data-id="${app.id}">
                    <div class="application-header">
                        <div class="application-image-section">
                            ${app.image_url ? 
                                `<div class="application-image-container">
                                    <img src="${app.image_url}" alt="${app.title}" class="application-image" data-image-error>
                                    <div class="application-icon" style="display: none;"><i class="fas fa-folder-open"></i></div>
                                </div>` : 
                                `<div class="application-icon"><i class="fas fa-folder-open"></i></div>`
                            }
                        </div>
                        <div class="application-title-section">
                            <h4 class="application-title">${app.title}</h4>
                            <span class="application-status status-pending">대기중</span>
                        </div>
                    </div>
                    
                    <div class="application-info">
                        <div class="info-item">
                            <span class="info-label">카테고리</span>
                            <span class="info-value">${app.category}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">신청자</span>
                            <span class="info-value">${app.applicant_name}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">연락처</span>
                            <span class="info-value">${app.contact}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">이메일</span>
                            <span class="info-value">${app.email}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">프로젝트 URL</span>
                            <span class="info-value">${app.project_url || '없음'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">신청일</span>
                            <span class="info-value">${formattedDate}</span>
                        </div>
                    </div>
                    
                    <div class="info-item">
                        <span class="info-label">프로젝트 설명</span>
                        <span class="info-value">${app.description}</span>
                    </div>
                    
                    <div class="application-actions">
                        <button class="btn-approve" data-action="approve-application" data-application-id="${app.id}">승인</button>
                        <button class="btn-reject" data-action="reject-application" data-application-id="${app.id}">거부</button>
                    </div>
                </div>
            `;
                }).join('');
            
            // 대기 중인 신청 탭에만 표시
            if (container) {
                container.innerHTML = pendingApplicationsHTML;
            }
            
            // 카운트 업데이트
            document.getElementById('pendingCount').textContent = pendingApplications.length;
            
        } catch (error) {
            console.error('신청 목록 로드 오류:', error);
        }
    }

    // 승인된 프로젝트 목록 로드
    async function loadApprovedProjects() {
        try {
            const response = await fetch('/api/projects'); // 공개 API
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const projects = await response.json();
            const container = document.getElementById('approvedProjects');
            const container2 = document.getElementById('approvedProjects2');
            
            const approvedProjectsHTML = projects.length === 0 
                ? '<div class="empty-state">승인된 프로젝트가 없습니다.</div>'
                : projects.map(project => {
                // 신청일 포맷팅 (YYYY-MM-DD)
                const applicationDate = project.application_date ? new Date(project.application_date) : new Date(project.created_at);
                const formattedApplicationDate = applicationDate.getFullYear() + '-' + 
                                               String(applicationDate.getMonth() + 1).padStart(2, '0') + '-' + 
                                               String(applicationDate.getDate()).padStart(2, '0');
                
                return `
                <div class="project-card" data-id="${project.id}">
                    <div class="application-header">
                        <h4 class="application-title">${project.title}</h4>
                        <span class="application-status status-approved">승인됨</span>
                    </div>
                    
                    <div class="application-info">
                        <div class="info-item">
                            <span class="info-label">카테고리</span>
                            <span class="info-value">${project.category}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">프로젝트 URL</span>
                            <span class="info-value">${project.project_url || '없음'}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">신청일</span>
                            <span class="info-value">${formattedApplicationDate}</span>
                        </div>
                        <div class="info-item">
                            <span class="info-label">승인일</span>
                            <span class="info-value">${new Date(project.created_at).toLocaleDateString('ko-KR')}</span>
                        </div>
                    </div>
                    
                    <div class="info-item">
                        <span class="info-label">프로젝트 설명</span>
                        <span class="info-value">${project.description}</span>
                    </div>
                    
                    <div class="application-actions">
                        <button class="btn-edit" data-action="edit-project" data-project-id="${project.id}">수정</button>
                        <button class="btn-delete" data-action="delete-project" data-project-id="${project.id}">삭제</button>
                    </div>
                </div>
            `;
                }).join('');
            
            // 승인된 프로젝트 탭에만 표시
            if (container) {
                container.innerHTML = approvedProjectsHTML;
            }
            
            // 카운트 업데이트
            document.getElementById('approvedCount').textContent = projects.length;
            
        } catch (error) {
            console.error('프로젝트 목록 로드 오류:', error);
        }
    }

    // 전역 함수들
    window.deleteUser = async function(userId) {
        if (!confirm('정말로 이 사용자를 삭제하시겠습니까?\n삭제된 사용자는 복구할 수 없습니다.')) {
            return;
        }
        
        try {
            const response = await adminAuthenticatedFetch(`/api/users/${userId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                alert('사용자가 삭제되었습니다.');
                // 데이터 새로고침
                loadUsers();
                loadApprovedUsersOnly();
            } else {
                alert(result.error || '사용자 삭제에 실패했습니다.');
            }
        } catch (error) {
            console.error('사용자 삭제 오류:', error);
            alert('사용자 삭제 중 오류가 발생했습니다.');
        }
    };

    window.approveUser = async function(userId) {
        if (!confirm('이 사용자를 승인하시겠습니까?')) {
            return;
        }
        
        try {
            const response = await adminAuthenticatedFetch(`/api/users/${userId}/approve`, {
                method: 'POST',
                body: JSON.stringify({})
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                alert('사용자가 승인되었습니다!');
                loadDashboardData(); // 데이터 새로고침
            } else {
                alert(result.error || '승인 처리에 실패했습니다.');
            }
        } catch (error) {
            console.error('사용자 승인 오류:', error);
            alert('승인 처리 중 오류가 발생했습니다.');
        }
    };

    window.rejectUser = async function(userId) {
        if (!confirm('정말로 이 사용자를 거부하시겠습니까?')) {
            return;
        }
        
        try {
            const response = await adminAuthenticatedFetch(`/api/users/${userId}/reject`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                alert('사용자가 거부되었습니다.');
                loadDashboardData(); // 데이터 새로고침
            } else {
                alert(result.error || '거부 처리에 실패했습니다.');
            }
        } catch (error) {
            console.error('사용자 거부 오류:', error);
            alert('거부 처리 중 오류가 발생했습니다.');
        }
    };

    window.approveApplication = async function(applicationId) {
        if (!confirm('이 프로젝트를 승인하시겠습니까?')) {
            return;
        }
        
        try {
            const response = await adminAuthenticatedFetch(`/api/applications/${applicationId}/approve`, {
                method: 'POST',
                body: JSON.stringify({})
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                alert('프로젝트가 승인되었습니다!');
                loadDashboardData(); // 데이터 새로고침
            } else {
                alert(result.error || '승인 처리에 실패했습니다.');
            }
        } catch (error) {
            console.error('승인 오류:', error);
            alert('승인 처리 중 오류가 발생했습니다.');
        }
    };

    window.rejectApplication = async function(applicationId) {
        if (!confirm('정말로 이 신청을 거부하시겠습니까?')) {
            return;
        }
        
        try {
            const response = await adminAuthenticatedFetch(`/api/applications/${applicationId}/reject`, {
                method: 'POST'
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                alert('신청이 거부되었습니다.');
                loadDashboardData(); // 데이터 새로고침
            } else {
                alert(result.error || '거부 처리에 실패했습니다.');
            }
        } catch (error) {
            console.error('거부 오류:', error);
            alert('거부 처리 중 오류가 발생했습니다.');
        }
    };

    // 프로젝트 수정 모달 열기
    window.editProject = async function(projectId) {
        try {
            const response = await fetch(`/api/projects/${projectId}`); // 공개 API
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const project = await response.json();
            
            if (project) {
                // 모달 폼에 데이터 채우기
                document.getElementById('editTitle').value = project.title;
                document.getElementById('editDescription').value = project.description;
                document.getElementById('editProjectUrl').value = project.project_url || '';
                document.getElementById('editImageSize').value = project.image_size || 'cover';
                document.getElementById('editDetailUrl').value = project.detail_url || '';
                // 파일 입력은 값을 설정할 수 없으므로 숨겨진 입력에 JSON 데이터 저장
                document.getElementById('editDetailImagesJson').value = project.detail_images || '';
                document.getElementById('editDetailDescription').value = project.detail_description || '';
                document.getElementById('editFeatures').value = project.features || '';
                document.getElementById('editTechStack').value = project.tech_stack || '';
                document.getElementById('editLinks').value = project.links || '';
                
                // 프로젝트 이미지들 미리보기 표시
                let allImages = [];
                
                // 프로젝트 이미지들 처리 (여러 이미지)
                if (project.project_images) {
                    try {
                        const projectImages = JSON.parse(project.project_images);
                        allImages = allImages.concat(projectImages);
                    } catch (e) {
                        console.error('프로젝트 이미지 데이터 파싱 오류:', e);
                    }
                }
                
                // 기존 메인 이미지가 있으면 추가 (중복 방지)
                if (project.image_url && !allImages.includes(project.image_url)) {
                    allImages.unshift(project.image_url); // 맨 앞에 추가
                }
                
                // 상세 이미지들이 있으면 추가 (중복 방지)
                if (project.detail_images) {
                    try {
                        const detailImages = JSON.parse(project.detail_images);
                        detailImages.forEach(img => {
                            if (!allImages.includes(img)) {
                                allImages.push(img);
                            }
                        });
                    } catch (e) {
                        console.error('상세 이미지 데이터 파싱 오류:', e);
                    }
                }
                
                // 모든 이미지를 미리보기에 표시
                loadProjectImages(allImages);
                
                // 통합된 이미지들을 hidden 필드에 저장 (file input에는 값을 직접 넣을 수 없음)
                const imagesJsonInput = document.getElementById('editDetailImagesJson');
                if (imagesJsonInput) {
                    imagesJsonInput.value = JSON.stringify(allImages);
                }
                
                // 모달에 프로젝트 ID 저장
                document.getElementById('editProjectForm').dataset.projectId = projectId;
                
                // 모달 표시
                const editModal = document.getElementById('editModal');
                if (editModal) {
                    editModal.style.display = 'flex';
                    
                    // 모달이 완전히 렌더링된 후 이미지 업로드 기능 설정
                    // setTimeout을 사용하여 DOM 업데이트가 완료된 후 실행
                    setTimeout(() => {
                        setupImageUpload();
                    }, 100);
                }
            }
        } catch (error) {
            console.error('프로젝트 정보 로드 오류:', error);
            alert('프로젝트 정보를 불러오는 중 오류가 발생했습니다. 프로젝트가 존재하지 않을 수 있습니다.');
        }
    };

    // 모달 닫기
    window.closeEditModal = function() {
        const modal = document.getElementById('editModal');
        const form = document.getElementById('editProjectForm');
        if (modal) modal.style.display = 'none';
        if (form) form.reset();
    };
    
    // 이미지 업로드 기능 초기화
    function setupImageUpload() {
        const fileSelectArea = document.getElementById('fileSelectArea');
        const editDetailImages = document.getElementById('editDetailImages');
        
        if (!fileSelectArea || !editDetailImages) {
            return;
        }
        
        // 기존 클릭 핸들러 제거 후 새로 추가
        if (fileSelectArea._clickHandler) {
            fileSelectArea.removeEventListener('click', fileSelectArea._clickHandler);
        }
        
        fileSelectArea._clickHandler = function(e) {
            e.preventDefault();
            e.stopPropagation();
            editDetailImages.click();
        };
        
        fileSelectArea.addEventListener('click', fileSelectArea._clickHandler);
        
        // 파일 선택 change 이벤트 처리
        if (editDetailImages._previousHandler) {
            editDetailImages.removeEventListener('change', editDetailImages._previousHandler);
        }
        
        editDetailImages._previousHandler = async function(e) {
            await handleImageChange(e);
        };
        
        editDetailImages.addEventListener('change', editDetailImages._previousHandler);
    }
    
    // 파일 선택 변경 핸들러
    async function handleImageChange(e) {
        const editDetailImages = e.target;
        const editDetailImagesPreview = document.getElementById('editImagesPreview');
        const fileNameDisplay = document.getElementById('fileNameDisplay');
        const files = Array.from(editDetailImages.files);
        
        if (files.length === 0) {
            if (fileNameDisplay) {
                fileNameDisplay.textContent = '선택된 파일 없음';
            }
            return;
        }
        
        // 파일명 표시
        if (fileNameDisplay) {
            if (files.length === 1) {
                fileNameDisplay.textContent = files[0].name;
            } else {
                fileNameDisplay.textContent = `${files.length}개의 파일 선택됨`;
            }
        }
        
        // 이미지 업로드
        if (files.length > 0) {
            await uploadMultipleImages(files, editDetailImages, editDetailImagesPreview);
            // 파일 입력 초기화 (같은 파일 다시 선택 가능하도록)
            editDetailImages.value = '';
        }
    }
    
    // 이벤트 위임 및 모달 버튼 설정 (함수 정의 후 호출)
    setupEventDelegation();
    setupModalCloseButtons();
    setupImageUpload(); // 초기 이미지 업로드 기능 설정

    async function uploadMultipleImages(files, fileInput, previewContainer) {
        const formData = new FormData();
        files.forEach(file => {
            formData.append('images', file);
        });

        try {
            const response = await adminAuthenticatedFetch('/api/upload-multiple', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                let errorMessage = '이미지 업로드 실패';
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || errorMessage;
                } catch (e) {
                    errorMessage = `서버 오류 (${response.status})`;
                }
                throw new Error(errorMessage);
            }

            const result = await response.json();

            if (result.success) {
                // 기존 이미지와 새 이미지 합치기
                const existingImagesJson = document.getElementById('editDetailImagesJson');
                let existingImages = [];
                
                if (existingImagesJson && existingImagesJson.value) {
                    try {
                        existingImages = JSON.parse(existingImagesJson.value);
                    } catch (e) {
                        existingImages = [];
                    }
                }
                
                // 새 이미지 추가
                const allImages = [...existingImages, ...result.imageUrls];
                if (existingImagesJson) {
                    existingImagesJson.value = JSON.stringify(allImages);
                }
                
                // 미리보기 표시 (모든 이미지)
                loadProjectImages(allImages);
            } else {
                alert('이미지 업로드에 실패했습니다: ' + (result.error || '알 수 없는 오류'));
            }
        } catch (error) {
            console.error('이미지 업로드 오류:', error);
            alert('이미지 업로드 중 오류가 발생했습니다: ' + error.message);
        }
    }
    
    function loadProjectImages(imageUrls) {
        const previewContainer = document.getElementById('editImagesPreview');
        if (!previewContainer) return;
        
        previewContainer.innerHTML = '';
        if (imageUrls && imageUrls.length > 0) {
            imageUrls.forEach(url => {
                const imgWrapper = document.createElement('div');
                imgWrapper.className = 'preview-image-wrapper';
                
                const img = document.createElement('img');
                img.src = url;
                img.alt = '프로젝트 이미지';
                img.className = 'preview-image';
                
                const removeBtn = document.createElement('button');
                removeBtn.className = 'remove-image-btn';
                removeBtn.textContent = '×';
                removeBtn.type = 'button';
                removeBtn.addEventListener('click', () => {
                    const updatedImages = imageUrls.filter(imgUrl => imgUrl !== url);
                    const existingImagesJson = document.getElementById('editDetailImagesJson');
                    if (existingImagesJson) {
                        existingImagesJson.value = JSON.stringify(updatedImages);
                    }
                    loadProjectImages(updatedImages);
                });
                
                imgWrapper.appendChild(img);
                imgWrapper.appendChild(removeBtn);
                previewContainer.appendChild(imgWrapper);
            });
        }
    }

    // 프로젝트 수정 폼 제출
    document.getElementById('editProjectForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        
        const projectId = this.dataset.projectId;
        const formData = new FormData(this);
        
        // detail_images는 hidden 필드의 JSON 값 사용
        const detailImagesJson = document.getElementById('editDetailImagesJson');
        const detailImagesValue = detailImagesJson ? detailImagesJson.value : '';
        
        const data = {
            title: formData.get('title'),
            description: formData.get('description'),
            project_url: formData.get('project_url'),
            image_size: formData.get('image_size'),
            detail_url: formData.get('detail_url'),
            detail_images: detailImagesValue, // JSON 문자열로 전달
            detail_description: formData.get('detail_description'),
            features: formData.get('features'),
            tech_stack: formData.get('tech_stack'),
            links: formData.get('links')
        };
        
        try {
            const response = await adminAuthenticatedFetch(`/api/projects/${projectId}`, {
                method: 'PUT',
                body: JSON.stringify(data)
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                alert('프로젝트가 수정되었습니다!');
                closeEditModal();
                loadDashboardData(); // 데이터 새로고침
            } else {
                alert(result.error || '수정 처리에 실패했습니다.');
            }
        } catch (error) {
            console.error('수정 오류:', error);
            alert('수정 처리 중 오류가 발생했습니다.');
        }
    });

    window.deleteProject = async function(projectId) {
        if (!confirm('정말로 이 프로젝트를 삭제하시겠습니까?')) {
            return;
        }
        
        try {
            const response = await adminAuthenticatedFetch(`/api/projects/${projectId}`, {
                method: 'DELETE'
            });
            
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({ error: '서버 오류' }));
                if (response.status === 401) {
                    // 이미 adminAuthenticatedFetch에서 처리됨
                    return;
                }
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
                alert('프로젝트가 삭제되었습니다.');
                loadDashboardData(); // 데이터 새로고침
            } else {
                alert(result.error || '삭제 처리에 실패했습니다.');
            }
        } catch (error) {
            // adminAuthenticatedFetch에서 이미 로그아웃 처리한 경우는 무시
            if (error.message === '인증이 만료되었습니다.' || error.message === '세션이 만료되었습니다.') {
                return;
            }
            console.error('삭제 오류:', error);
            alert(error.message || '삭제 처리 중 오류가 발생했습니다.');
        }
    };

    // 탭 네비게이션 설정
    function setupTabNavigation() {
        const tabBtns = document.querySelectorAll('.tab-btn');
        const tabContents = document.querySelectorAll('.tab-content');

        if (tabBtns.length === 0) {
            console.error('탭 버튼을 찾을 수 없습니다.');
            return;
        }

        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.tab;
                
                // 같은 섹션 내의 탭 버튼들만 비활성화
                const section = btn.closest('.content-section');
                const sectionTabBtns = section.querySelectorAll('.tab-btn');
                const sectionTabContents = section.querySelectorAll('.tab-content');
                
                sectionTabBtns.forEach(tabBtn => tabBtn.classList.remove('active'));
                btn.classList.add('active');
                
                sectionTabContents.forEach(content => content.classList.remove('active'));
                
                // 탭 ID 매핑
                const tabIdMap = {
                    'pending-users': 'pendingUsersTab',
                    'approved-users': 'approvedUsersTab',
                    'rejected-users': 'rejectedUsersTab',
                    'pending-projects': 'pendingProjectsTab',
                    'approved-projects': 'approvedProjectsTab',
                    'activity-logs': 'activityLogsTab',
                    'login-attempts': 'loginAttemptsTab'
                };
                
                const targetTabId = tabIdMap[tab];
                const targetTab = targetTabId ? document.getElementById(targetTabId) : null;
                
                if (targetTab) {
                    targetTab.classList.add('active');
                } else {
                    console.error(`탭 요소를 찾을 수 없습니다: ${tab} (ID: ${targetTabId})`);
                }
                
                // 탭 전환 시 모든 데이터 로드
                if (tab === 'pending-users' || tab === 'approved-users' || tab === 'rejected-users') {
                    // 사용자 탭일 때 모든 사용자 데이터 로드
                    loadAllUserData();
                } else if (tab === 'pending-projects' || tab === 'approved-projects') {
                    // 프로젝트 탭일 때 모든 프로젝트 데이터 로드
                    loadAllProjectData();
                } else if (tab === 'activity-logs') {
                    // 활동 로그 탭일 때 로그 로드
                    loadActivityLogs();
                } else if (tab === 'login-attempts') {
                    // 로그인 시도 탭일 때 로그인 시도 로드
                    loadLoginAttempts();
                }
            });
        });
    }

    // 승인된 사용자 로드
    async function loadApprovedUsers() {
        try {
            const response = await adminAuthenticatedFetch('/api/users');
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const users = await response.json();
            const approvedUsers = users.filter(user => user.status === 'approved');
            
            const approvedUsersHTML = approvedUsers.length === 0 
                ? '<div class="empty-state">승인된 사용자가 없습니다.</div>'
                : approvedUsers.map(user => {
                    const createdDate = new Date(user.created_at).toLocaleDateString('ko-KR');
                    const approvedDate = user.approved_at ? new Date(user.approved_at).toLocaleDateString('ko-KR') : '알 수 없음';
                    
                    return `
                    <div class="application-card user-card" data-id="${user.id}" data-user-id="${user.id}" style="cursor: pointer;">
                        <div class="application-header">
                            <h4 class="application-title">${user.full_name}</h4>
                            <span class="application-status status-approved">승인됨</span>
                        </div>
                        
                        <div class="application-info">
                            <div class="info-item">
                                <span class="info-label">이메일</span>
                                <span class="info-value">${escapeHtml(user.email || '')}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">아이디</span>
                                <span class="info-value">${escapeHtml(user.username || '미설정')}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">학년/반/번호</span>
                                <span class="info-value">${user.grade}학년 ${user.class_name}반 ${user.student_number}번</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">가입일</span>
                                <span class="info-value">${createdDate}</span>
                            </div>
                            <div class="info-item">
                                <span class="info-label">승인일</span>
                                <span class="info-value">${approvedDate}</span>
                            </div>
                        </div>
                            
                        <div class="application-actions">
                            <button class="btn-reject" data-action="reject-user" data-user-id="${user.id}">승인 취소</button>
                        </div>
                    </div>
                    `;
                }).join('');
            
            // 승인된 사용자 탭에만 표시
            const approvedContainer = document.getElementById('approvedUsers');
            if (approvedContainer) {
                approvedContainer.innerHTML = approvedUsersHTML;
            }
            
            // 카운트 업데이트
            document.getElementById('approvedUsersCount').textContent = approvedUsers.length;
            
        } catch (error) {
            console.error('승인된 사용자 로드 오류:', error);
        }
    }

    // 모든 사용자 데이터 로드
    async function loadAllUserData() {
        try {
            await loadUsers();
            await loadApprovedUsers();
        } catch (error) {
            console.error('사용자 데이터 로드 오류:', error);
        }
    }

    // 모든 프로젝트 데이터 로드
    async function loadAllProjectData() {
        try {
            await loadApplications();
            await loadApprovedProjects();
        } catch (error) {
            console.error('프로젝트 데이터 로드 오류:', error);
        }
    }

    // 활동 로그 로드
    async function loadActivityLogs() {
        try {
            const response = await adminAuthenticatedFetch('/api/admin/activity-logs?limit=100');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            const logsList = document.getElementById('activityLogsList');
            
            if (!logsList) return;
            
            if (!data.logs || data.logs.length === 0) {
                logsList.innerHTML = '<div class="empty-state">활동 로그가 없습니다.</div>';
                return;
            }
            
            const logText = data.logs.map(log => {
                // UTC 시간 문자열을 KST로 변환
                const dateStr = log.created_at;
                // SQLite DATETIME은 UTC로 저장되어 있으므로, UTC로 파싱 후 KST로 변환
                const date = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z'));
                // KST = UTC + 9시간
                const kstTime = date.getTime() + (9 * 60 * 60 * 1000);
                const kstDate = new Date(kstTime);
                
                const year = kstDate.getFullYear();
                const month = String(kstDate.getMonth() + 1).padStart(2, '0');
                const day = String(kstDate.getDate()).padStart(2, '0');
                const hour = String(kstDate.getHours()).padStart(2, '0');
                const minute = String(kstDate.getMinutes()).padStart(2, '0');
                const second = String(kstDate.getSeconds()).padStart(2, '0');
                
                const formattedDate = `${year}. ${month}. ${day}. ${hour}:${minute}:${second}`;
                
                const username = escapeHtml(log.username || '알 수 없음');
                const ip = escapeHtml(log.ip_address || '알 수 없음');
                const action = escapeHtml(log.action || '알 수 없음');
                const details = log.details ? ` | ${escapeHtml(log.details)}` : '';
                
                return `[${formattedDate}] ${username} | ${ip} | ${action}${details}`;
            }).join('\n');
            
            logsList.innerHTML = '<pre class="log-terminal">' + logText + '</pre>';
        } catch (error) {
            console.error('활동 로그 로드 오류:', error);
            const logsList = document.getElementById('activityLogsList');
            if (logsList) {
                logsList.innerHTML = '<div class="empty-state">활동 로그를 불러오는 중 오류가 발생했습니다.</div>';
            }
        }
    }

    // 로그인 시도 로그 로드
    async function loadLoginAttempts() {
        try {
            const response = await adminAuthenticatedFetch('/api/admin/login-attempts?limit=100');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            const attemptsList = document.getElementById('loginAttemptsList');
            
            if (!attemptsList) return;
            
            if (!data.attempts || data.attempts.length === 0) {
                attemptsList.innerHTML = '<div class="empty-state">로그인 시도 기록이 없습니다.</div>';
                return;
            }
            
            const attemptsText = data.attempts.map(attempt => {
                // UTC 시간 문자열을 KST로 변환
                const dateStr = attempt.created_at;
                // SQLite DATETIME은 UTC로 저장되어 있으므로, UTC로 파싱 후 KST로 변환
                const date = new Date(dateStr + (dateStr.includes('Z') ? '' : 'Z'));
                // KST = UTC + 9시간
                const kstTime = date.getTime() + (9 * 60 * 60 * 1000);
                const kstDate = new Date(kstTime);
                
                const year = kstDate.getFullYear();
                const month = String(kstDate.getMonth() + 1).padStart(2, '0');
                const day = String(kstDate.getDate()).padStart(2, '0');
                const hour = String(kstDate.getHours()).padStart(2, '0');
                const minute = String(kstDate.getMinutes()).padStart(2, '0');
                const second = String(kstDate.getSeconds()).padStart(2, '0');
                
                const formattedDate = `${year}. ${month}. ${day}. ${hour}:${minute}:${second}`;
                
                const username = escapeHtml(attempt.username || '알 수 없음');
                const ip = escapeHtml(attempt.ip_address || '알 수 없음');
                const status = attempt.success === 1 ? '성공' : '실패';
                
                return `[${formattedDate}] ${username} | ${ip} | ${status}`;
            }).join('\n');
            
            attemptsList.innerHTML = '<pre class="log-terminal">' + attemptsText + '</pre>';
        } catch (error) {
            console.error('로그인 시도 로그 로드 오류:', error);
            const attemptsList = document.getElementById('loginAttemptsList');
            if (attemptsList) {
                attemptsList.innerHTML = '<div class="empty-state">로그인 시도 기록을 불러오는 중 오류가 발생했습니다.</div>';
            }
        }
    }

    // 이벤트 위임 설정
    function setupEventDelegation() {
        // 전체 문서에 이벤트 위임
        document.addEventListener('click', function(e) {
            const target = e.target.closest('[data-action]');
            if (!target) return;

            const action = target.dataset.action;
            
            if (action === 'approve-user') {
                const userId = parseInt(target.dataset.userId);
                if (userId && window.approveUser) window.approveUser(userId);
            } else if (action === 'reject-user') {
                const userId = parseInt(target.dataset.userId);
                if (userId && window.rejectUser) window.rejectUser(userId);
            } else if (action === 'approve-application') {
                const applicationId = parseInt(target.dataset.applicationId);
                if (applicationId && window.approveApplication) window.approveApplication(applicationId);
            } else if (action === 'reject-application') {
                const applicationId = parseInt(target.dataset.applicationId);
                if (applicationId && window.rejectApplication) window.rejectApplication(applicationId);
            } else if (action === 'edit-project') {
                const projectId = parseInt(target.dataset.projectId);
                if (projectId && window.editProject) window.editProject(projectId);
            } else if (action === 'delete-project') {
                const projectId = parseInt(target.dataset.projectId);
                if (projectId && window.deleteProject) window.deleteProject(projectId);
            }
        });

        // 이미지 에러 핸들러
        document.addEventListener('error', function(e) {
            if (e.target.classList.contains('application-image') && e.target.dataset.imageError) {
                e.target.style.display = 'none';
                const icon = e.target.nextElementSibling;
                if (icon && icon.classList.contains('application-icon')) {
                    icon.style.display = 'flex';
                }
            }
        }, true);
    }

    // 모달 닫기 버튼 설정
    function setupModalCloseButtons() {
        const closeBtn = document.getElementById('closeEditModalBtn');
        const cancelBtn = document.getElementById('cancelEditBtn');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', function() {
                if (window.closeEditModal) window.closeEditModal();
            });
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function() {
                if (window.closeEditModal) window.closeEditModal();
            });
        }
        
    }

    // 사용자 상세 정보 모달 표시
    window.showUserDetail = async function(userId) {
        try {
            const response = await adminAuthenticatedFetch(`/api/users/${userId}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const user = await response.json();
            
            // 날짜 포맷팅 함수
            function formatDate(dateString) {
                if (!dateString) return '알 수 없음';
                const date = new Date(dateString + (dateString.includes('Z') ? '' : 'Z'));
                const kstTime = date.getTime() + (9 * 60 * 60 * 1000);
                const kstDate = new Date(kstTime);
                
                const year = kstDate.getFullYear();
                const month = String(kstDate.getMonth() + 1).padStart(2, '0');
                const day = String(kstDate.getDate()).padStart(2, '0');
                const hour = String(kstDate.getHours()).padStart(2, '0');
                const minute = String(kstDate.getMinutes()).padStart(2, '0');
                const second = String(kstDate.getSeconds()).padStart(2, '0');
                
                return `${year}. ${month}. ${day}. ${hour}:${minute}:${second}`;
            }
            
            // 상태 텍스트
            let statusText = '';
            let statusColor = '';
            if (user.status === 'pending') {
                statusText = '승인 대기';
                statusColor = '#ff9800';
            } else if (user.status === 'approved') {
                statusText = '승인됨';
                statusColor = '#4caf50';
            } else if (user.status === 'rejected') {
                statusText = '거부됨';
                statusColor = '#f44336';
            }
            
            const detailHTML = `
                <div class="user-detail-header">
                    <h3 class="user-detail-name">${escapeHtml(user.full_name || '')}</h3>
                    <span class="user-detail-status-badge" style="background-color: ${statusColor}; color: white;">${statusText}</span>
                </div>
                
                <div class="user-detail-main-info">
                    <div class="user-detail-info-row">
                        <span class="user-detail-label">이메일</span>
                        <span class="user-detail-value">${escapeHtml(user.email || '')}</span>
                    </div>
                    <div class="user-detail-info-row">
                        <span class="user-detail-label">아이디</span>
                        <span class="user-detail-value">${escapeHtml(user.username || '미설정')}</span>
                    </div>
                    <div class="user-detail-info-row">
                        <span class="user-detail-label">학년/반/번호</span>
                        <span class="user-detail-value">${user.grade}학년 ${user.class_name}반 ${user.student_number}번</span>
                    </div>
                    <div class="user-detail-info-row">
                        <span class="user-detail-label">가입일</span>
                        <span class="user-detail-value">${formatDate(user.created_at)}</span>
                    </div>
                    ${user.approved_at ? `
                    <div class="user-detail-info-row">
                        <span class="user-detail-label">승인일</span>
                        <span class="user-detail-value">${formatDate(user.approved_at)}</span>
                    </div>
                    ` : ''}
                </div>
                
                <div class="user-detail-section">
                    <h4 class="user-detail-section-title">회원가입 시 수집된 정보</h4>
                    <div class="user-detail-info-grid">
                        <div class="user-detail-info-item">
                            <span class="user-detail-label">IP 주소</span>
                            <span class="user-detail-value user-detail-code">${escapeHtml(user.signup_ip_address || '수집되지 않음')}</span>
                        </div>
                        <div class="user-detail-info-item">
                            <span class="user-detail-label">플랫폼</span>
                            <span class="user-detail-value">${escapeHtml(user.signup_platform === 'unknown' || !user.signup_platform ? '자동 감지 실패' : user.signup_platform)}</span>
                        </div>
                        <div class="user-detail-info-item">
                            <span class="user-detail-label">디바이스 타입</span>
                            <span class="user-detail-value">${escapeHtml(user.signup_device_type === 'unknown' || !user.signup_device_type ? '자동 감지 실패' : user.signup_device_type)}</span>
                        </div>
                        <div class="user-detail-info-item">
                            <span class="user-detail-label">언어</span>
                            <span class="user-detail-value">${escapeHtml(user.signup_accept_language || '수집되지 않음')}</span>
                        </div>
                    </div>
                </div>
            `;
            
            const modal = document.getElementById('userDetailModal');
            const content = document.getElementById('userDetailContent');
            
            if (modal && content) {
                content.innerHTML = detailHTML;
                modal.style.display = 'flex';
                modal.classList.add('modal-show');
            }
        } catch (error) {
            console.error('사용자 상세 정보 로드 오류:', error);
            alert('사용자 상세 정보를 불러오는 중 오류가 발생했습니다.');
        }
    };

    // 사용자 상세 정보 모달 닫기
    function closeUserDetailModal() {
        const modal = document.getElementById('userDetailModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('modal-show');
        }
    }
    
    // 모달 외부 클릭 시 닫기
    document.addEventListener('click', function(e) {
        const userDetailModal = document.getElementById('userDetailModal');
        if (userDetailModal && e.target === userDetailModal) {
            closeUserDetailModal();
        }
    });
    
    // 사용자 카드 클릭 이벤트 위임
    document.addEventListener('click', function(e) {
        const userCard = e.target.closest('.user-card');
        if (userCard && !e.target.closest('.application-actions')) {
            const userId = userCard.getAttribute('data-user-id');
            if (userId) {
                showUserDetail(parseInt(userId));
            }
        }
        
    });
});
