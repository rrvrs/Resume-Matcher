#!/bin/bash

# Resume-Matcher Docker Setup Script
# Production-quality containerized deployment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║               Resume-Matcher Docker Setup                   ║"
    echo "║           Production-Quality Containerized Deployment       ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

check_prerequisites() {
    print_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed. Please install Docker first."
        echo "Visit: https://docs.docker.com/get-docker/"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed."
        echo "Visit: https://docs.docker.com/compose/install/"
        exit 1
    fi
    
    # Check if Docker is running
    if ! docker info &> /dev/null; then
        print_error "Docker is not running. Please start Docker first."
        exit 1
    fi
    
    # Check available memory (Linux/macOS)
    if command -v free &> /dev/null; then
        available_mem=$(free -g | awk '/^Mem:/{print $7}')
        if [ "$available_mem" -lt 6 ]; then
            print_warning "Less than 6GB RAM available. Ollama might run slowly."
        fi
    fi
    
    print_success "All prerequisites met!"
}

show_usage() {
    echo -e "${BLUE}Usage:${NC}"
    echo "  $0 [OPTION]"
    echo ""
    echo "Options:"
    echo "  production, prod, p     Start production environment"
    echo "  development, dev, d     Start development environment with hot-reload"
    echo "  stop, down             Stop all services"
    echo "  status                 Show service status"
    echo "  logs                   Show service logs"
    echo "  clean                  Clean up containers and volumes"
    echo "  help, h                Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 production          # Start production environment"
    echo "  $0 dev                 # Start development environment"
    echo "  $0 status              # Check service status"
}

start_production() {
    print_info "Starting production environment..."
    
    # Build images if they don't exist
    if ! docker images | grep -q "resume-matcher"; then
        print_info "Building Docker images (this may take a few minutes)..."
        docker-compose build
    fi
    
    # Start services
    docker-compose up -d
    
    print_success "Production environment started!"
    print_info "Services starting up... This may take 5-10 minutes on first run."
    echo ""
    echo -e "${GREEN}🌐 Frontend:${NC} http://localhost:3000"
    echo -e "${GREEN}🔧 Backend API:${NC} http://localhost:8000/api/docs"
    echo -e "${GREEN}🤖 Ollama API:${NC} http://localhost:11434"
    echo ""
    echo "Monitor startup: docker-compose logs -f"
}

start_development() {
    print_info "Starting development environment with hot-reload..."
    
    # Build development images
    docker-compose -f docker-compose.dev.yml build
    
    # Start services
    docker-compose -f docker-compose.dev.yml up -d
    
    print_success "Development environment started!"
    print_info "Code changes will be automatically reloaded."
    echo ""
    echo -e "${GREEN}🌐 Frontend:${NC} http://localhost:3000"
    echo -e "${GREEN}🔧 Backend API:${NC} http://localhost:8000/api/docs"
    echo -e "${GREEN}🤖 Ollama API:${NC} http://localhost:11434"
    echo ""
    echo "Monitor logs: docker-compose -f docker-compose.dev.yml logs -f"
}

stop_services() {
    print_info "Stopping all services..."
    
    # Stop production
    if docker-compose ps -q &> /dev/null; then
        docker-compose down
    fi
    
    # Stop development
    if docker-compose -f docker-compose.dev.yml ps -q &> /dev/null; then
        docker-compose -f docker-compose.dev.yml down
    fi
    
    print_success "All services stopped!"
}

show_status() {
    print_info "Service Status:"
    echo ""
    
    # Check production services
    if docker-compose ps -q &> /dev/null; then
        echo -e "${BLUE}Production Services:${NC}"
        docker-compose ps
        echo ""
    fi
    
    # Check development services
    if docker-compose -f docker-compose.dev.yml ps -q &> /dev/null; then
        echo -e "${BLUE}Development Services:${NC}"
        docker-compose -f docker-compose.dev.yml ps
        echo ""
    fi
    
    # Check if no services are running
    if ! docker-compose ps -q &> /dev/null && ! docker-compose -f docker-compose.dev.yml ps -q &> /dev/null; then
        echo "No Resume-Matcher services are currently running."
        echo "Use '$0 production' or '$0 development' to start services."
    fi
}

show_logs() {
    print_info "Recent logs from all services:"
    echo ""
    
    # Show production logs if running
    if docker-compose ps -q &> /dev/null; then
        echo -e "${BLUE}Production Logs:${NC}"
        docker-compose logs --tail=50
    fi
    
    # Show development logs if running
    if docker-compose -f docker-compose.dev.yml ps -q &> /dev/null; then
        echo -e "${BLUE}Development Logs:${NC}"
        docker-compose -f docker-compose.dev.yml logs --tail=50
    fi
}

clean_up() {
    print_warning "This will remove all containers, volumes, and images!"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Cleaning up..."
        
        # Stop all services
        docker-compose down -v --remove-orphans 2>/dev/null || true
        docker-compose -f docker-compose.dev.yml down -v --remove-orphans 2>/dev/null || true
        
        # Remove images
        docker images | grep "resume-matcher" | awk '{print $3}' | xargs docker rmi -f 2>/dev/null || true
        
        # Clean up system
        docker system prune -f
        
        print_success "Cleanup completed!"
    else
        print_info "Cleanup cancelled."
    fi
}

main() {
    print_header
    
    # Check prerequisites first
    check_prerequisites
    
    case "${1:-}" in
        production|prod|p)
            start_production
            ;;
        development|dev|d)
            start_development
            ;;
        stop|down)
            stop_services
            ;;
        status)
            show_status
            ;;
        logs)
            show_logs
            ;;
        clean)
            clean_up
            ;;
        help|h)
            show_usage
            ;;
        "")
            print_info "No option specified. Starting production environment..."
            start_production
            ;;
        *)
            print_error "Unknown option: $1"
            echo ""
            show_usage
            exit 1
            ;;
    esac
}

# Run main function
main "$@" 