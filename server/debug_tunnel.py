import socket
import ssl
import sys

def debug_websocket_handshake(host, path):
    print(f"\n--- Testing WebSocket Handshake on path: '{path}' ---")
    
    # Create standard SSL context
    context = ssl.create_default_context()
    
    try:
        # Establish raw TCP socket on SSL port 443
        sock = socket.create_connection((host, 443), timeout=5)
        with context.wrap_socket(sock, server_hostname=host) as ssock:
            # Build manual WebSocket Upgrade HTTP request
            request = (
                f"GET {path} HTTP/1.1\r\n"
                f"Host: {host}\r\n"
                f"Upgrade: websocket\r\n"
                f"Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
                f"Sec-WebSocket-Version: 13\r\n\r\n"
            )
            
            ssock.sendall(request.encode('utf-8'))
            
            # Read first 4096 bytes of server response
            response = ssock.recv(4096).decode('utf-8', errors='ignore')
            
            # Parse only the headers
            header_part = response.split('\r\n\r\n')[0]
            lines = header_part.split('\r\n')
            
            print(f"Status Line: \033[1;36m{lines[0]}\033[0m")
            print("Response Headers:")
            for line in lines[1:]:
                print(f"  {line}")
                
            return lines[0]
            
    except Exception as e:
        print(f"\033[1;31mConnection Failed:\033[0m {e}")
        return None

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python debug_tunnel.py <domain_without_https>")
        print("Example: python debug_tunnel.py apexapp-zvh4.onrender.com")
        sys.exit(1)
        
    target_host = sys.argv[1].replace("https://", "").replace("http://", "").split("/")[0]
    print(f"🔍 Diagnostic starting for host: {target_host}")
    
    paths_to_test = ["/", "/_frws", "/_frpc", "/~!frp", "/~frp"]
    
    for test_path in paths_to_test:
        debug_websocket_handshake(target_host, test_path)