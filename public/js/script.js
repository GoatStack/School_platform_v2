// 메인 JavaScript 파일

document.addEventListener('DOMContentLoaded', function() {
    // 로그인 상태 확인 및 UI 업데이트
    checkLoginStatus();
    
    // 승인된 프로젝트 목록 로드
    loadApprovedProjects();
});

function checkLoginStatus() {
    const userInfo = document.getElementById('userInfo');
    const guestNav = document.getElementById('guestNav');
    const userName = document.getElementById('userName');
    const logoutBtn = document.getElementById('logoutBtn');
    const menuToggle = document.getElementById('menuToggle');
    const dropdownMenu = document.getElementById('dropdownMenu');
    
    if (isUserLoggedIn()) {
        const userData = JSON.parse(localStorage.getItem('userInfo') || '{}');
        safeHtmlInsert(userName, `${userData.fullName}님`);
        userInfo.style.display = 'flex';
        guestNav.style.display = 'none';
        
        // 햄버거 메뉴 토글
        if (menuToggle && dropdownMenu) {
            menuToggle.addEventListener('click', function(e) {
                e.stopPropagation();
                menuToggle.classList.toggle('active');
                dropdownMenu.classList.toggle('active');
            });
            
            // 메뉴 외부 클릭 시 닫기
            document.addEventListener('click', function(e) {
                if (!userInfo.contains(e.target)) {
                    menuToggle.classList.remove('active');
                    dropdownMenu.classList.remove('active');
                }
            });
        }
        
        // 로그아웃 버튼 이벤트
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function() {
                logoutUser();
                location.reload();
            });
        }
    } else {
        userInfo.style.display = 'none';
        guestNav.style.display = 'flex';
    }
}

async function loadApprovedProjects() {
    try {
        const response = await fetch('/api/projects');
        const projects = await response.json();
        renderProjects(projects);
    } catch (error) {
        console.error('프로젝트 로드 오류:', error);
        renderProjects([]);
    }
}

function renderProjects(projects) {
    const projectsGrid = document.getElementById('projects-grid');
    const emptyState = document.getElementById('empty-state');
    
    if (!projectsGrid || !emptyState) return;
    
    projectsGrid.innerHTML = '';
    
    if (projects.length === 0) {
        projectsGrid.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }
    
    projectsGrid.style.display = 'grid';
    emptyState.style.display = 'none';
    
    projects.forEach(project => {
        const projectCard = createProjectCard(project);
        projectsGrid.appendChild(projectCard);
    });
}

function createProjectCard(project) {
    const card = document.createElement('a');
    card.href = `/project-detail?id=${project.id}`;
    card.className = 'project-card';
    
    const badge = document.createElement('div');
    badge.className = 'project-category-badge';
    safeHtmlInsert(badge, project.category);
    
    const content = document.createElement('div');
    content.className = 'project-content';
    
    const title = document.createElement('h3');
    title.className = 'project-title';
    safeHtmlInsert(title, project.title);
    
    const description = document.createElement('p');
    description.className = 'project-description';
    safeHtmlInsert(description, project.description);
    
    content.appendChild(title);
    content.appendChild(description);
    card.appendChild(badge);
    card.appendChild(content);
    
    return card;
}

