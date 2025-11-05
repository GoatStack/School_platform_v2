// 프로젝트 상세 페이지 JavaScript

document.addEventListener('DOMContentLoaded', function() {
    // 로그인 상태 확인 및 UI 업데이트
    checkLoginStatus();
    
    // URL에서 프로젝트 ID 가져오기
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('id');
    
    if (!projectId) {
        alert('프로젝트 ID가 없습니다.');
        window.location.href = '/';
        return;
    }
    
    // 프로젝트 정보 로드
    loadProjectDetail(projectId);
});

function checkLoginStatus() {
    const isLoggedIn = localStorage.getItem('userLoggedIn') === 'true';
    const userInfo = document.getElementById('userInfo');
    const guestNav = document.getElementById('guestNav');
    const userName = document.getElementById('userName');
    const logoutBtn = document.getElementById('logoutBtn');
    
    // 요소들이 존재하지 않으면 함수 종료
    if (!userInfo || !guestNav || !userName || !logoutBtn) {
        return;
    }
    
    if (isLoggedIn) {
        const userData = JSON.parse(localStorage.getItem('userInfo') || '{}');
        userName.textContent = `${userData.fullName}님`;
        userInfo.style.display = 'flex';
        guestNav.style.display = 'none';
        
        // 로그아웃 버튼 이벤트
        logoutBtn.addEventListener('click', function() {
            localStorage.removeItem('userLoggedIn');
            localStorage.removeItem('userInfo');
            location.reload();
        });
    } else {
        userInfo.style.display = 'none';
        guestNav.style.display = 'flex';
    }
}

async function loadProjectDetail(projectId) {
    try {
        const response = await fetch(`/api/projects/${projectId}`);
        const project = await response.json();
        
        if (!response.ok) {
            throw new Error(project.error || '프로젝트를 불러올 수 없습니다.');
        }
        
        // 프로젝트 정보 표시
        displayProjectInfo(project);
        
    } catch (error) {
        console.error('프로젝트 로드 오류:', error);
        alert('프로젝트를 불러오는 중 오류가 발생했습니다.');
        window.location.href = '/';
    }
}

function displayProjectInfo(project) {
    // 제목 설정
    document.title = `${project.title} - Make;-Dev`;
    
    // 카테고리 배지
    const categoryBadge = document.getElementById('project-category');
    categoryBadge.textContent = project.category;
    
    // 프로젝트 제목
    const title = document.getElementById('project-title');
    title.textContent = project.title;
    
    // 프로젝트 날짜
    const date = document.getElementById('project-date');
    date.textContent = project.deadline || '날짜 미정';
    
    // 프로젝트 설명
    const description = document.getElementById('project-description');
    description.textContent = project.detail_description || project.description;
    
    // 이미지 갤러리 설정
    setupImageGallery(project);
    
    // 주요 기능 설정
    setupFeatures(project.features);
    
    // 사용 기술 설정
    setupTechStack(project.tech_stack);
    
    // 관련 링크 설정
    setupLinks(project);
}

function setupImageGallery(project) {
    const mainImage = document.getElementById('main-image');
    const thumbnailList = document.getElementById('thumbnail-list');
    
    // 이미지 데이터 파싱
    let images = [];
    
    // 프로젝트 이미지들 처리 (여러 이미지)
    if (project.project_images) {
        try {
            const projectImages = JSON.parse(project.project_images);
            images = images.concat(projectImages);
        } catch (e) {
            console.error('프로젝트 이미지 데이터 파싱 오류:', e);
        }
    }
    
    // 기존 메인 이미지가 있으면 추가 (중복 방지)
    if (project.image_url && !images.includes(project.image_url)) {
        images.unshift(project.image_url); // 맨 앞에 추가
    }
    
    // 상세 이미지들이 있으면 추가 (중복 방지)
    if (project.detail_images) {
        try {
            const detailImages = JSON.parse(project.detail_images);
            detailImages.forEach(img => {
                if (!images.includes(img)) {
                    images.push(img);
                }
            });
        } catch (e) {
            console.error('상세 이미지 데이터 파싱 오류:', e);
        }
    }
    
    if (images.length === 0) {
        // 이미지가 없는 경우
        mainImage.innerHTML = '<div class="main-image-placeholder">이미지가 없습니다</div>';
        thumbnailList.innerHTML = '';
        return;
    }
    
    // 메인 이미지 설정
    const mainImg = document.createElement('img');
    mainImg.src = images[0];
    mainImg.alt = project.title;
    mainImage.innerHTML = '';
    mainImage.appendChild(mainImg);
    
    // 전체화면 클릭 이벤트 추가
    mainImage.addEventListener('click', () => {
        openFullscreen(0, images);
    });
    
    // 썸네일 생성
    thumbnailList.innerHTML = '';
    images.forEach((imageUrl, index) => {
        const thumbnail = document.createElement('div');
        thumbnail.className = 'thumbnail';
        if (index === 0) thumbnail.classList.add('active');
        
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = `${project.title} - 이미지 ${index + 1}`;
        
        thumbnail.appendChild(img);
        thumbnail.addEventListener('click', (e) => {
            e.stopPropagation(); // 이벤트 버블링 방지
            
            // 메인 이미지 변경
            mainImg.src = imageUrl;
            
            // 활성 썸네일 변경
            document.querySelectorAll('.thumbnail').forEach(t => t.classList.remove('active'));
            thumbnail.classList.add('active');
            
            // 전체화면 열기
            openFullscreen(index, images);
        });
        
        thumbnailList.appendChild(thumbnail);
    });
}

function setupFeatures(featuresData) {
    const featuresList = document.getElementById('project-features');
    
    if (!featuresData) {
        featuresList.innerHTML = '<li>주요 기능 정보가 없습니다.</li>';
        return;
    }
    
    let features = [];
    try {
        features = JSON.parse(featuresData);
    } catch (e) {
        // JSON이 아닌 경우 줄바꿈으로 분리
        features = featuresData.split('\n').filter(f => f.trim());
    }
    
    if (features.length === 0) {
        featuresList.innerHTML = '<li>주요 기능 정보가 없습니다.</li>';
        return;
    }
    
    featuresList.innerHTML = '';
    features.forEach(feature => {
        const li = document.createElement('li');
        li.textContent = feature.trim();
        featuresList.appendChild(li);
    });
}

function setupTechStack(techData) {
    const techStack = document.getElementById('project-tech-stack');
    
    if (!techData) {
        techStack.innerHTML = '<span class="tech-tag">기술 정보 없음</span>';
        return;
    }
    
    let techs = [];
    try {
        techs = JSON.parse(techData);
    } catch (e) {
        // JSON이 아닌 경우 쉼표로 분리
        techs = techData.split(',').map(t => t.trim()).filter(t => t);
    }
    
    if (techs.length === 0) {
        techStack.innerHTML = '<span class="tech-tag">기술 정보 없음</span>';
        return;
    }
    
    techStack.innerHTML = '';
    techs.forEach(tech => {
        const tag = document.createElement('span');
        tag.className = 'tech-tag';
        tag.textContent = tech.trim();
        techStack.appendChild(tag);
    });
}

function setupLinks(project) {
    const linksContainer = document.getElementById('project-links');
    
    const links = [];
    
    // 프로젝트 URL이 있으면 추가
    if (project.project_url) {
        links.push({
            text: '프로젝트 바로가기',
            url: project.project_url
        });
    }
    
    // 추가 링크가 있으면 파싱
    if (project.links) {
        try {
            const additionalLinks = JSON.parse(project.links);
            links.push(...additionalLinks);
        } catch (e) {
            // JSON이 아닌 경우 줄바꿈으로 분리
            const linkLines = project.links.split('\n').filter(l => l.trim());
            linkLines.forEach(line => {
                const parts = line.split('|');
                if (parts.length >= 2) {
                    links.push({
                        text: parts[0].trim(),
                        url: parts[1].trim()
                    });
                }
            });
        }
    }
    
    if (links.length === 0) {
        linksContainer.innerHTML = '<p>관련 링크가 없습니다.</p>';
        return;
    }
    
    linksContainer.innerHTML = '';
    links.forEach(link => {
        const linkElement = document.createElement('a');
        linkElement.className = 'project-link';
        linkElement.href = link.url;
        linkElement.target = '_blank';
        linkElement.rel = 'noopener noreferrer';
        linkElement.textContent = link.text;
        linksContainer.appendChild(linkElement);
    });
}

// 전체화면 관련 전역 변수
let currentImages = [];
let currentImageIndex = 0;

// 전체화면 열기
function openFullscreen(index, images) {
    currentImages = images;
    currentImageIndex = index;
    
    const modal = document.getElementById('fullscreenModal');
    const fullscreenImage = document.getElementById('fullscreenImage');
    const currentIndexSpan = document.getElementById('currentImageIndex');
    const totalImagesSpan = document.getElementById('totalImages');
    
    fullscreenImage.src = images[index];
    fullscreenImage.style.objectFit = 'contain'; // 원본 비율 유지
    fullscreenImage.style.maxWidth = '100%';
    fullscreenImage.style.maxHeight = '100%';
    fullscreenImage.style.width = 'auto';
    fullscreenImage.style.height = 'auto';
    currentIndexSpan.textContent = index + 1;
    totalImagesSpan.textContent = images.length;
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden'; // 배경 스크롤 방지
}

// 전체화면 닫기
function closeFullscreen() {
    const modal = document.getElementById('fullscreenModal');
    modal.classList.remove('active');
    document.body.style.overflow = 'auto'; // 배경 스크롤 복원
}

// 이전 이미지
function prevImage() {
    if (currentImages.length === 0) return;
    
    currentImageIndex = (currentImageIndex - 1 + currentImages.length) % currentImages.length;
    const fullscreenImage = document.getElementById('fullscreenImage');
    const currentIndexSpan = document.getElementById('currentImageIndex');
    
    fullscreenImage.src = currentImages[currentImageIndex];
    fullscreenImage.style.objectFit = 'contain';
    fullscreenImage.style.maxWidth = '100%';
    fullscreenImage.style.maxHeight = '100%';
    fullscreenImage.style.width = 'auto';
    fullscreenImage.style.height = 'auto';
    currentIndexSpan.textContent = currentImageIndex + 1;
}

// 다음 이미지
function nextImage() {
    if (currentImages.length === 0) return;
    
    currentImageIndex = (currentImageIndex + 1) % currentImages.length;
    const fullscreenImage = document.getElementById('fullscreenImage');
    const currentIndexSpan = document.getElementById('currentImageIndex');
    
    fullscreenImage.src = currentImages[currentImageIndex];
    fullscreenImage.style.objectFit = 'contain';
    fullscreenImage.style.maxWidth = '100%';
    fullscreenImage.style.maxHeight = '100%';
    fullscreenImage.style.width = 'auto';
    fullscreenImage.style.height = 'auto';
    currentIndexSpan.textContent = currentImageIndex + 1;
}

// 키보드 이벤트 처리
document.addEventListener('keydown', function(e) {
    const modal = document.getElementById('fullscreenModal');
    if (!modal.classList.contains('active')) return;
    
    switch(e.key) {
        case 'Escape':
            closeFullscreen();
            break;
        case 'ArrowLeft':
            prevImage();
            break;
        case 'ArrowRight':
            nextImage();
            break;
    }
});

// 모달 배경 클릭 시 닫기 및 버튼 이벤트 리스너
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('fullscreenModal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === this) {
                closeFullscreen();
            }
        });
    }

    // 전체화면 버튼 이벤트 리스너
    const closeBtn = document.getElementById('closeFullscreenBtn');
    const prevBtn = document.getElementById('prevImageBtn');
    const nextBtn = document.getElementById('nextImageBtn');
    
    if (closeBtn) {
        closeBtn.addEventListener('click', closeFullscreen);
    }
    
    if (prevBtn) {
        prevBtn.addEventListener('click', prevImage);
    }
    
    if (nextBtn) {
        nextBtn.addEventListener('click', nextImage);
    }
});

