-- Dados iniciais do CRM
-- Senha padrão para todos: 123456 (hash bcrypt)

-- Inserir usuários iniciais
INSERT INTO usuarios (id, nome, email, senha, avatar, role, ativo) VALUES
('user-1', 'Carlos Silva', 'carlos@solartech.com', '$2b$10$rQZ8K1k2k3k4k5k6k7k8kuEEzG5J5h5h5h5h5h5h5h5h5h5h5h5h5', 'CS', 'admin', TRUE),
('user-2', 'Ana Oliveira', 'ana@solartech.com', '$2b$10$rQZ8K1k2k3k4k5k6k7k8kuEEzG5J5h5h5h5h5h5h5h5h5h5h5h5h5', 'AO', 'gerente', TRUE),
('user-3', 'Pedro Santos', 'pedro@solartech.com', '$2b$10$rQZ8K1k2k3k4k5k6k7k8kuEEzG5J5h5h5h5h5h5h5h5h5h5h5h5h5', 'PS', 'vendedor', TRUE),
('user-4', 'Maria Costa', 'maria@solartech.com', '$2b$10$rQZ8K1k2k3k4k5k6k7k8kuEEzG5J5h5h5h5h5h5h5h5h5h5h5h5h5', 'MC', 'vendedor', TRUE),
('user-5', 'João Ferreira', 'joao@solartech.com', '$2b$10$rQZ8K1k2k3k4k5k6k7k8kuEEzG5J5h5h5h5h5h5h5h5h5h5h5h5h5', 'JF', 'vendedor', FALSE)
ON DUPLICATE KEY UPDATE nome = VALUES(nome);

-- Inserir clientes iniciais
INSERT INTO clientes (id, nome, email, telefone, empresa, cargo, cidade, estado, origem, status_funil, valor_potencial, responsavel_id, observacoes) VALUES
('cli-1', 'Roberto Mendes', 'roberto@industria.com', '(11) 99999-1111', 'Indústria ABC', 'Diretor', 'São Paulo', 'SP', 'site', 'negociacao', 85000.00, 'user-3', 'Cliente interessado em sistema de 50kWp para indústria'),
('cli-2', 'Fernanda Lima', 'fernanda@comercio.com', '(11) 99999-2222', 'Comércio XYZ', 'Gerente', 'Campinas', 'SP', 'indicacao', 'orcamento_enviado', 32000.00, 'user-3', 'Indicação do cliente Roberto'),
('cli-3', 'Marcelo Souza', 'marcelo@fazenda.com', '(19) 99999-3333', 'Fazenda Sol Nascente', 'Proprietário', 'Ribeirão Preto', 'SP', 'google', 'em_atendimento', 120000.00, 'user-4', 'Interessado em sistema rural de grande porte'),
('cli-4', 'Patricia Alves', 'patricia@residencial.com', '(11) 99999-4444', NULL, NULL, 'Santos', 'SP', 'facebook', 'lead_novo', 15000.00, 'user-4', 'Residência com alto consumo mensal'),
('cli-5', 'Ricardo Gomes', 'ricardo@hotel.com', '(13) 99999-5555', 'Hotel Praia Azul', 'Administrador', 'Guarujá', 'SP', 'instagram', 'fechado', 95000.00, 'user-3', 'Projeto concluído - sistema de 80kWp'),
('cli-6', 'Amanda Ferreira', 'amanda@escola.com', '(11) 99999-6666', 'Colégio Educar', 'Diretora', 'São Bernardo', 'SP', 'telefone', 'negociacao', 45000.00, 'user-4', 'Escola particular interessada em energia solar'),
('cli-7', 'Bruno Carvalho', 'bruno@construtora.com', '(11) 99999-7777', 'Construtora Horizonte', 'Engenheiro', 'Osasco', 'SP', 'site', 'perdido', 200000.00, 'user-3', 'Perdido para concorrente - preço'),
('cli-8', 'Camila Rodrigues', 'camila@clinica.com', '(11) 99999-8888', 'Clínica Saúde Total', 'Sócia', 'Santo André', 'SP', 'indicacao', 'orcamento_enviado', 28000.00, 'user-4', 'Indicação da Amanda'),
('cli-9', 'Diego Martins', 'diego@restaurante.com', '(11) 99999-9999', 'Restaurante Sabor', 'Chef/Dono', 'São Paulo', 'SP', 'google', 'em_atendimento', 22000.00, 'user-3', 'Restaurante com alto consumo de energia'),
('cli-10', 'Elena Santos', 'elena@academia.com', '(11) 99999-0000', 'Academia Fitness Plus', 'Proprietária', 'Mogi das Cruzes', 'SP', 'facebook', 'lead_novo', 35000.00, 'user-4', 'Academia 24h com ar condicionado central')
ON DUPLICATE KEY UPDATE nome = VALUES(nome);

-- Inserir tarefas iniciais
INSERT INTO tarefas (id, titulo, descricao, tipo, data_hora, status, cliente_id, responsavel_id) VALUES
('task-1', 'Ligar para Roberto', 'Verificar interesse na proposta enviada', 'ligacao', '2026-03-19 10:00:00', 'pendente', 'cli-1', 'user-3'),
('task-2', 'Enviar proposta para Fernanda', 'Preparar e enviar proposta comercial', 'email', '2026-03-19 14:00:00', 'pendente', 'cli-2', 'user-3'),
('task-3', 'Visita técnica - Fazenda', 'Realizar visita técnica para dimensionamento', 'visita', '2026-03-20 09:00:00', 'pendente', 'cli-3', 'user-4'),
('task-4', 'Retornar ligação Patricia', 'Cliente solicitou mais informações', 'ligacao', '2026-03-18 16:00:00', 'atrasada', 'cli-4', 'user-4'),
('task-5', 'Reunião com Amanda', 'Apresentar projeto para diretoria', 'reuniao', '2026-03-21 15:00:00', 'pendente', 'cli-6', 'user-4'),
('task-6', 'Follow-up Diego', 'Verificar se recebeu materiais informativos', 'email', '2026-03-19 11:00:00', 'pendente', 'cli-9', 'user-3')
ON DUPLICATE KEY UPDATE titulo = VALUES(titulo);

-- Inserir propostas iniciais
INSERT INTO propostas (id, numero, cliente_id, responsavel_id, titulo, descricao, valor, desconto, valor_final, status, validade, servicos) VALUES
('prop-1', 'PROP-2026-001', 'cli-1', 'user-3', 'Sistema Fotovoltaico 50kWp', 'Sistema completo para indústria com monitoramento', 90000.00, 5.56, 85000.00, 'enviada', '2026-04-15', '["Painéis solares 550W (91 unidades)", "Inversor string 50kW", "Estrutura de fixação", "Instalação completa", "Monitoramento remoto", "Garantia 25 anos"]'),
('prop-2', 'PROP-2026-002', 'cli-2', 'user-3', 'Sistema Fotovoltaico 12kWp', 'Sistema para comércio de médio porte', 35000.00, 8.57, 32000.00, 'enviada', '2026-04-10', '["Painéis solares 550W (22 unidades)", "Inversor string 12kW", "Estrutura de fixação", "Instalação completa", "Garantia 25 anos"]'),
('prop-3', 'PROP-2026-003', 'cli-5', 'user-3', 'Sistema Fotovoltaico 80kWp', 'Sistema de grande porte para hotel', 100000.00, 5.00, 95000.00, 'aprovada', '2026-03-01', '["Painéis solares 550W (146 unidades)", "Inversores string", "Estrutura completa", "Instalação", "Monitoramento", "Manutenção 2 anos"]'),
('prop-4', 'PROP-2026-004', 'cli-6', 'user-4', 'Sistema Fotovoltaico 18kWp', 'Sistema para instituição de ensino', 48000.00, 6.25, 45000.00, 'em_analise', '2026-04-20', '["Painéis solares 550W (33 unidades)", "Inversor string 20kW", "Estrutura de fixação", "Instalação completa", "Garantia 25 anos"]'),
('prop-5', 'PROP-2026-005', 'cli-8', 'user-4', 'Sistema Fotovoltaico 10kWp', 'Sistema para clínica médica', 30000.00, 6.67, 28000.00, 'enviada', '2026-04-12', '["Painéis solares 550W (18 unidades)", "Inversor string 10kW", "Estrutura de fixação", "Instalação completa", "Garantia 25 anos"]')
ON DUPLICATE KEY UPDATE titulo = VALUES(titulo);

-- Inserir interações/histórico
INSERT INTO interacoes (id, cliente_id, usuario_id, tipo, descricao, dados, created_at) VALUES
('int-1', 'cli-1', 'user-3', 'ligacao', 'Primeiro contato - cliente interessado em energia solar para indústria', NULL, '2026-03-10 09:30:00'),
('int-2', 'cli-1', 'user-3', 'visita', 'Visita técnica realizada - dimensionamento de 50kWp', NULL, '2026-03-12 14:00:00'),
('int-3', 'cli-1', 'user-3', 'proposta', 'Proposta PROP-2026-001 enviada', '{"proposta_id": "prop-1"}', '2026-03-14 10:00:00'),
('int-4', 'cli-1', 'user-3', 'mudanca_status', 'Status alterado para Negociação', '{"de": "orcamento_enviado", "para": "negociacao"}', '2026-03-16 11:00:00'),
('int-5', 'cli-2', 'user-3', 'ligacao', 'Contato inicial - indicação do Roberto Mendes', NULL, '2026-03-11 10:00:00'),
('int-6', 'cli-2', 'user-3', 'proposta', 'Proposta PROP-2026-002 enviada', '{"proposta_id": "prop-2"}', '2026-03-15 09:00:00'),
('int-7', 'cli-5', 'user-3', 'proposta', 'Proposta PROP-2026-003 aprovada', '{"proposta_id": "prop-3"}', '2026-02-28 16:00:00'),
('int-8', 'cli-5', 'user-3', 'mudanca_status', 'Status alterado para Fechado', '{"de": "negociacao", "para": "fechado"}', '2026-02-28 16:30:00'),
('int-9', 'cli-3', 'user-4', 'email', 'Enviado material informativo sobre sistemas rurais', NULL, '2026-03-17 08:00:00'),
('int-10', 'cli-6', 'user-4', 'reuniao', 'Reunião com diretoria - apresentação inicial', NULL, '2026-03-13 15:00:00')
ON DUPLICATE KEY UPDATE descricao = VALUES(descricao);

-- Inserir configurações padrão
INSERT INTO configuracoes (id, chave, valor) VALUES
('conf-1', 'empresa', '{"nome": "SolarTech Energia", "cnpj": "12.345.678/0001-90", "telefone": "(11) 3333-4444", "email": "contato@solartech.com", "endereco": "Av. Paulista, 1000", "cidade": "São Paulo", "estado": "SP", "cep": "01310-100"}'),
('conf-2', 'notificacoes', '{"email": true, "desktop": true, "tarefas_atrasadas": true, "novos_leads": true, "propostas_aprovadas": true}'),
('conf-3', 'funil', '{"etapas": ["lead_novo", "em_atendimento", "orcamento_enviado", "negociacao", "fechado", "perdido"]}')
ON DUPLICATE KEY UPDATE valor = VALUES(valor);
